import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm";

const SUPABASE_URL = "https://mtddtvqtljtgzggpdogl.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_U5CdIRdPg0Brfn7x2Bj2hQ_VCXjwRQH";
const WORLD_ID = "main";
const TOPIC = "world:main";
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  realtime: { params: { eventsPerSecond: 20 } }
});

const state = {
  user: null, channel: null, joined: false, online: false,
  displayName: "", lastSent: 0, lastCheckpoint: 0, lastTrack: 0,
  lastPosition: null, remote: new Map(), profileCache: new Map(), connecting: false
};

function setStatus(message, connected = false) {
  let el = document.getElementById("ktk-online-status");
  if (!el) {
    el = document.createElement("div");
    el.id = "ktk-online-status";
    el.style.cssText = "position:absolute;top:18px;left:50%;transform:translateX(-50%);z-index:20;padding:8px 13px;border:1px solid rgba(238,247,226,.2);border-radius:999px;background:rgba(17,39,27,.88);color:#e7efdf;font:700 11px system-ui;pointer-events:none;white-space:nowrap";
    document.querySelector(".hud-top")?.appendChild(el);
  }
  el.textContent = message;
  el.style.borderColor = connected ? "rgba(155,215,135,.55)" : "rgba(238,190,120,.45)";
}

function readLocal() {
  const data = window.KTKWorldEntities?.getLocalState?.();
  if (!data) return null;
  return {
    user_id: state.user?.id,
    display_name: state.displayName,
    x: Number(data.x), y: Number(data.y),
    direction: Number(data.direction) || 2,
    character: data.character || {},
    is_alive: true,
    updated_at: Date.now()
  };
}

function updateRemotes() {
  if (window.KTKWorldEntities?.setRemotePlayers) {
    window.KTKWorldEntities.setRemotePlayers([...state.remote.values()]);
  }
}

function acceptDatabaseChange(payload) {
  const row = payload?.new || payload?.record || payload;
  if (!row?.user_id || row.user_id === state.user?.id) return;
  if (row.is_alive === false) {
    state.remote.delete(String(row.user_id));
    updateRemotes();
    return;
  }
  acceptRemote({
    user_id: row.user_id, x: row.x, y: row.y, direction: row.direction,
    display_name: row.display_name, character: row.character
  });
  if (!state.profileCache.has(String(row.user_id))) {
    state.profileCache.set(String(row.user_id), true);
    void supabase.from("ktk_profiles").select("display_name,character")
      .eq("id", row.user_id).maybeSingle().then(({ data }) => {
        if (!data) return;
        const remote = state.remote.get(String(row.user_id));
        if (!remote) return;
        remote.displayName = data.display_name || "Aventureiro";
        remote.display_name = remote.displayName;
        remote.character = data.character || {};
        updateRemotes();
      });
  }
}

function acceptRemote(payload) {
  if (!payload || !payload.user_id || payload.user_id === state.user?.id) return;
  const x = Number(payload.x), y = Number(payload.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const id = String(payload.user_id);
  const previous = state.remote.get(id);
  const hasCharacter = payload.character && Object.keys(payload.character).length > 0;
  state.remote.set(id, {
    id,
    display_name: String(payload.display_name || payload.displayName || previous?.display_name || "Aventureiro").slice(0, 24),
    displayName: String(payload.display_name || payload.displayName || previous?.displayName || "Aventureiro").slice(0, 24),
    x: previous?.x ?? x,
    y: previous?.y ?? y,
    targetX: x,
    targetY: y,
    direction: Math.max(0, Math.min(3, Number(payload.direction) || 2)),
    character: hasCharacter ? payload.character : (previous?.character || {}),
    type: "player",
    lastUpdate: Date.now()
  });
  updateRemotes();
}

function rebuildPresence() {
  if (!state.channel) return;
  const presence = state.channel.presenceState();
  const active = new Set();
  Object.values(presence).flat().forEach(entry => {
    if (!entry?.user_id || entry.user_id === state.user?.id) return;
    active.add(String(entry.user_id));
    acceptRemote(entry);
  });
  for (const id of state.remote.keys()) if (!active.has(id)) state.remote.delete(id);
  updateRemotes();
}

async function loadExistingPlayers() {
  const cutoff = new Date(Date.now() - 30000).toISOString();
  const { data, error } = await supabase
    .from("ktk_world_players")
    .select("user_id,x,y,direction,is_alive,last_seen_at")
    .eq("world_id", WORLD_ID)
    .eq("is_alive", true)
    .gte("last_seen_at", cutoff);
  if (error) throw error;
  const rows = data || [];
  if (!rows.length) return;
  const ids = rows.map(row => row.user_id).filter(id => id !== state.user.id);
  if (!ids.length) return;
  const { data: profiles, error: profileError } = await supabase
    .from("ktk_profiles")
    .select("id,display_name,character")
    .in("id", ids);
  if (profileError) throw profileError;
  const byId = new Map((profiles || []).map(profile => [profile.id, profile]));
  rows.forEach(row => {
    const profile = byId.get(row.user_id) || {};
    state.profileCache.set(String(row.user_id), true);
    acceptRemote({
      user_id: row.user_id, x: row.x, y: row.y, direction: row.direction,
      display_name: profile.display_name, character: profile.character
    });
  });
}

async function subscribeWorld() {
  await supabase.realtime.setAuth();
  state.channel = supabase.channel(TOPIC, {
    config: {
      private: true,
      broadcast: { self: false, ack: false },
      presence: { key: state.user.id }
    }
  });
  state.channel
    .on("broadcast", { event: "INSERT" }, ({ payload }) => acceptDatabaseChange(payload))
    .on("broadcast", { event: "UPDATE" }, ({ payload }) => acceptDatabaseChange(payload))
    .on("broadcast", { event: "position" }, ({ payload }) => acceptRemote(payload))
    .on("presence", { event: "sync" }, rebuildPresence)
    .on("presence", { event: "join" }, rebuildPresence)
    .on("presence", { event: "leave" }, rebuildPresence);

  await new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Tempo esgotado ao conectar ao mundo online."));
    }, 12000);
    state.channel.subscribe(status => {
      if (status === "SUBSCRIBED" && !settled) {
        settled = true; clearTimeout(timeout); resolve();
      } else if ((status === "CHANNEL_ERROR" || status === "TIMED_OUT") && !settled) {
        settled = true; clearTimeout(timeout);
        reject(new Error("Não foi possível entrar no canal multiplayer (" + status + ")."));
      }
    });
  });
  state.online = true;
  await loadExistingPlayers();
  await trackPresence();
  setStatus("● Online · mundo principal", true);
}

async function trackPresence() {
  if (!state.channel || !state.online) return;
  const payload = readLocal();
  if (!payload) return;
  const { error } = await state.channel.track(payload);
  if (error) console.warn("KTK presence:", error.message);
  state.lastTrack = Date.now();
}

async function sendPosition(force = false) {
  if (!state.online || !state.channel || !state.joined) return;
  const payload = readLocal();
  if (!payload) return;
  const now = Date.now();
  const previous = state.lastPosition;
  const moved = !previous || Math.hypot(payload.x - previous.x, payload.y - previous.y) > 0.35 ||
    payload.direction !== previous.direction;

  if (moved && (force || now - state.lastSent >= 60)) {
    state.lastSent = now;
    state.lastPosition = { x: payload.x, y: payload.y, direction: payload.direction };
    const packet = {
      user_id: state.user.id,
      display_name: state.displayName,
      x: payload.x, y: payload.y,
      direction: payload.direction,
      character: payload.character
    };
    // Broadcast de baixa latência: não espera a gravação periódica no banco.
    void state.channel.send({ type: "broadcast", event: "position", payload: packet })
      .then(result => {
        if (result?.status && result.status !== "ok") console.warn("KTK position broadcast:", result.status);
      })
      .catch(error => console.warn("KTK position broadcast:", error));
  }

  if (now - state.lastTrack >= 10000) void trackPresence();
  if (now - state.lastCheckpoint >= 1000) {
    state.lastCheckpoint = now;
    const { error: checkpointError } = await supabase.rpc("ktk_checkpoint_player", {
      p_x: payload.x, p_y: payload.y, p_direction: payload.direction
    });
    if (checkpointError && !String(checkpointError.message || "").includes("MOVEMENT_TOO_FAST")) {
      console.warn("KTK checkpoint:", checkpointError.message);
    }
  }
}

async function enter(options = {}) {
  if (state.connecting) return { ok: false, error: "A conexão já está sendo iniciada." };
  state.connecting = true;
  try {
    const displayName = String(options.displayName || "").trim().slice(0, 24);
    if (displayName.length < 2) throw new Error("Escolha um nome com pelo menos 2 caracteres.");
    state.displayName = displayName;
    localStorage.setItem("ktk-display-name", displayName);

    let { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    if (!sessionData.session) {
      const result = await supabase.auth.signInAnonymously();
      if (result.error) throw new Error("Não foi possível criar sua conta de jogador. Confira se o login anônimo está ativado no Supabase: " + result.error.message);
      sessionData = { session: result.data.session };
    }
    state.user = sessionData.session.user;

    let player;
    if (options.newCharacter) {
      const { data, error } = await supabase.rpc("ktk_create_new_character", {
        p_display_name: displayName, p_character: options.character || {}
      });
      if (error) throw error;
      player = data;
    } else {
      const { data, error } = await supabase.rpc("ktk_join_world", {
        p_display_name: displayName, p_character: options.character || {}
      });
      if (error) throw error;
      player = data?.player;
    }
    if (!player?.is_alive) {
      return { ok: false, dead: true, player, error: "Este personagem morreu. Crie outro para voltar ao mundo." };
    }
    await subscribeWorld();
    state.joined = true;
    return { ok: true, player };
  } catch (error) {
    console.error("KTK online:", error);
    if (state.channel) {
      try { await supabase.removeChannel(state.channel); } catch (cleanupError) {
        console.warn("KTK channel cleanup:", cleanupError);
      }
    }
    state.channel = null;
    state.online = false;
    state.joined = false;
    state.remote.clear();
    updateRemotes();
    const code = error?.code || error?.error_code || "";
    const message = String(error?.message || "");
    if (code === "anonymous_provider_disabled" || message.includes("Anonymous sign-ins are disabled")) {
      return {
        ok: false,
        error: "O login de jogadores está desativado no servidor. No Supabase, abra Authentication → Sign In / Providers → Anonymous e ative Anonymous Sign-Ins."
      };
    }
    return { ok: false, error: message || "Falha ao conectar ao servidor." };
  } finally {
    state.connecting = false;
  }
}

async function markDead() {
  if (!state.user) return;
  const { error } = await supabase.rpc("ktk_mark_dead");
  if (error) console.error("KTK death save:", error);
  if (state.channel) {
    await state.channel.send({ type: "broadcast", event: "leave", payload: { user_id: state.user.id } });
    await supabase.removeChannel(state.channel);
  }
  state.channel = null;
  state.online = false;
  state.joined = false;
  state.remote.clear();
  updateRemotes();
  setStatus("○ Personagem morto · fora do mundo", false);
}

function startHeartbeat() {
  setInterval(() => {
    if (!state.online || !state.joined) return;
    sendPosition(false);
  }, 100);
  window.addEventListener("beforeunload", () => {
    if (state.channel) supabase.removeChannel(state.channel);
  });
}

window.KTKOnline = {
  enter, markDead,
  get userId() { return state.user?.id || null; },
  get connected() { return state.online; }
};

document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("ktk-display-name");
  if (input) input.value = localStorage.getItem("ktk-display-name") || "";
  startHeartbeat();
});
