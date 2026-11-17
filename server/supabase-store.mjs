const PLAYER_COLUMNS = [
  "user_id", "world_id", "x", "y", "direction", "is_alive",
  "last_seen_at", "position_updated_at", "state"
].join(",");

export class SupabaseStore {
  constructor({
    url = process.env.SUPABASE_URL,
    publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY,
    secretKey = process.env.SUPABASE_SECRET_KEY
  } = {}) {
    if (!url || !publishableKey || !secretKey) {
      throw new Error("Configure SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY e SUPABASE_SECRET_KEY no ambiente do servidor.");
    }
    this.baseUrl = String(url).replace(/\/$/, "");
    this.publishableKey = publishableKey;
    this.secretKey = secretKey;
    this.catalog = null;
  }

  async request(path, { key = "secret", token = null, method = "GET", body = undefined, prefer = null } = {}) {
    const apiKey = key === "publishable" ? this.publishableKey : this.secretKey;
    const headers = { apikey: apiKey, Accept: "application/json" };
    if (token) headers.Authorization = "Bearer " + token;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (prefer) headers.Prefer = prefer;

    const response = await fetch(this.baseUrl + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8000)
    });
    const text = await response.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); }
      catch { throw new Error("O Supabase devolveu uma resposta inválida (" + response.status + ")."); }
    }
    if (!response.ok) {
      const message = typeof data?.message === "string" ? data.message :
        typeof data?.msg === "string" ? data.msg : "HTTP " + response.status;
      throw new Error("Supabase: " + message);
    }
    return data;
  }

  async authenticateUser(accessToken) {
    if (typeof accessToken !== "string" || accessToken.length < 40 || accessToken.length > 8192) {
      throw new Error("TOKEN_INVALIDO");
    }
    const user = await this.request("/auth/v1/user", {
      key: "publishable",
      token: accessToken
    });
    if (!user?.id) throw new Error("TOKEN_INVALIDO");
    return user;
  }

  async loadCatalog(accessToken) {
    if (this.catalog) return this.catalog;
    const rows = await this.request("/rest/v1/rpc/ktk_get_equipment_catalog", {
      key: "publishable",
      token: accessToken,
      method: "POST",
      body: {}
    });
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error("CATALOGO_DE_EQUIPAMENTOS_INDISPONIVEL");
    }
    this.catalog = rows;
    return rows;
  }

  async loadWorldData() {
    const playerQuery = new URLSearchParams({
      select: PLAYER_COLUMNS,
      world_id: "eq.main",
      is_alive: "eq.true",
      order: "user_id.asc"
    });
    const entityQuery = new URLSearchParams({
      select: "world_id,entity_id,entity_type,x,y,collision_radius,state,revision,updated_at",
      world_id: "eq.main"
    });
    const players = await this.request("/rest/v1/ktk_world_players?" + playerQuery);
    const ids = players.map(row => row.user_id).filter(Boolean);
    let profiles = [];
    if (ids.length) {
      const profileQuery = new URLSearchParams({
        select: "id,display_name,character,clan_color",
        id: "in.(" + ids.join(",") + ")"
      });
      profiles = await this.request("/rest/v1/ktk_profiles?" + profileQuery);
    }
    const entities = await this.request("/rest/v1/ktk_world_entities?" + entityQuery);
    return {
      players,
      profiles: new Map(profiles.map(profile => [String(profile.id), profile])),
      entities
    };
  }

  async leaveWorld(accessToken) {
    return await this.request("/rest/v1/rpc/ktk_leave_world", {
      key: "publishable",
      token: accessToken,
      method: "POST",
      body: {}
    });
  }

  async persistPositions(players) {
    const payload = (Array.isArray(players) ? players : [])
      .filter(player => player?.id && Number.isFinite(player.x) && Number.isFinite(player.y))
      .map(player => ({
        user_id: player.id,
        expected_position_updated_at: player.expectedPositionUpdatedAt,
        x: player.x,
        y: player.y,
        direction: player.direction,
        input_x: player.inputX,
        input_y: player.inputY,
        moving: player.moving,
        running: player.running,
        guarding: player.guarding
      }));
    if (!payload.length) return [];
    return await this.request("/rest/v1/rpc/ktk_sync_live_positions", {
      key: "secret",
      method: "POST",
      body: { p_positions: payload }
    });
  }
}
