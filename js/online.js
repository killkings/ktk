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
  displayName: "", lastSent: 0, lastCheckpoint: 0, lastTrack: 0, lastDbHeartbeat: 0,
  lastPosition: null, lastAppearanceSignature: "", lastIntentSignature: "", positionSequence: 0, positionInFlight: false, combatSequence: 0,
  sessionId: window.crypto?.randomUUID?.() || (String(Date.now()) + "-" + Math.random().toString(36).slice(2)),
  remote: new Map(), profileCache: new Map(), seenCombatEvents: new Set(),
  lastLocalKnockbackAt: "", intentInFlight: false, worldStateRequestId: 0, connecting: false
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
    direction: Number.isFinite(Number(data.direction)) ? Math.max(0, Math.min(3, Number(data.direction))) : 2,
    character: data.character || {},
    wearables: data.wearables || {},
    combat_stats: data.combatStats || {},
    moving: Boolean(data.moving),
    running: Boolean(data.running),
    guarding: Boolean(data.guarding),
    is_alive: true,
    updated_at: Date.now()
  };
}

function updateRemotes() {
  if (window.KTKWorldEntities?.setRemotePlayers) {
    window.KTKWorldEntities.setRemotePlayers([...state.remote.values()]);
  }
}

function acceptWorldEntityChange(payload, deleted = false) {
  const row=payload?.record||payload?.new||payload?.old||payload;
  if(row?.entity_id) window.KTKWorldEntities?.applyWorldEntity?.({...row,deleted});
}

async function loadWorldState() {
  const requestId=++state.worldStateRequestId;
  const {data,error}=await supabase.rpc("ktk_get_world_state");
  if(error) throw error;
  // Se duas fotografias se cruzarem na rede, só aplica a última solicitada.
  if(requestId===state.worldStateRequestId) {
    window.KTKWorldEntities?.applyWorldState?.(data);
  }
  return data;
}

function acceptDatabaseChange(payload) {
  const row = payload?.new || payload?.record || payload;
  if (!row?.user_id) return;
  if (row.user_id === state.user?.id) {
    if (row.state) window.KTKWorldEntities?.applyServerState?.(row.state);
    const knockbackAt=String(row.state?.last_knockback_at||"");
    if (row.is_alive !== false && knockbackAt && knockbackAt!==state.lastLocalKnockbackAt) {
      state.lastLocalKnockbackAt=knockbackAt;
      window.KTKWorldEntities?.applyServerKnockback?.(
        row.state?.last_knockback, row.x, row.y, row.direction
      );
    }
    if (row.is_alive === false) window.KTKWorldEntities?.serverDeath?.();
    return;
  }
  if (row.is_alive === false) {
    state.remote.delete(String(row.user_id));
    updateRemotes();
    return;
  }
  const serverState=row.state&&typeof row.state==="object"?row.state:{};
  const remote=acceptRemote({
    user_id: row.user_id, x: row.x, y: row.y, direction: row.direction,
    position_updated_at: row.position_updated_at,
    display_name: row.display_name, character: row.character,
    combat_stats: {
      health:serverState.health,maxHealth:serverState.max_health,
      stamina:serverState.stamina,maxStamina:serverState.max_stamina,
      satiety:serverState.satiety,maxSatiety:99,
      hydration:serverState.hydration,maxHydration:99
    }
  }, "database");
  const changedRemote=state.remote.get(String(row.user_id));
  const knockbackAt=String(serverState.last_knockback_at||"");
  if(changedRemote&&serverState.last_knockback&&knockbackAt&&knockbackAt!==changedRemote.lastServerKnockbackAt) {
    changedRemote.lastServerKnockbackAt=knockbackAt;
    changedRemote.knockback={
      x:Number(serverState.last_knockback.x)||0,
      y:Number(serverState.last_knockback.y)||0,
      progress:0
    };
  }
  const attackAt=String(serverState.last_attack_at||"");
  if(changedRemote&&attackAt&&attackAt!==changedRemote.lastServerAttackAt) {
    changedRemote.lastServerAttackAt=attackAt;
    changedRemote.attackAnimation={
      startedAt:performance.now(),
      duration:0.42,
      frameCount:6,
      type:String(serverState.last_attack_type||"punch"),
      direction:Number.isFinite(Number(serverState.last_attack_direction))
        ? Math.max(0,Math.min(3,Number(serverState.last_attack_direction))) : 2
    };
  }
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

function acceptRemote(payload, source = "broadcast") {
  if (!payload || !payload.user_id || payload.user_id === state.user?.id) return;
  const x = Number(payload.x), y = Number(payload.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const id = String(payload.user_id);
  const previous = state.remote.get(id);

  // Presence e banco servem para descobrir quem já está no mundo, mas seus
  // retratos podem ter até vários segundos. Nunca deixam um jogador já
  // sincronizado voltar para uma coordenada antiga.
  if (previous && source === "presence") return;

  const sessionId = String(payload.session_id || "");
  const rawSequence = Number(payload.sequence);
  const hasSequence = Number.isSafeInteger(rawSequence) && rawSequence >= 0;
  const databasePositionAt = payload.position_updated_at ? Date.parse(payload.position_updated_at) : 0;
  const sentAt = Number(payload.sent_at) || (Number.isFinite(databasePositionAt) ? databasePositionAt : 0);
  const isDatabasePosition = source === "database" || source === "database-snapshot";
  const staleDatabasePosition = Boolean(previous && isDatabasePosition && sentAt > 0 &&
    previous.lastPositionAt > 0 && sentAt < previous.lastPositionAt);

  // Bloqueia pacotes de posição fora de ordem e pacotes atrasados de uma
  // sessão anterior do mesmo jogador. Para a mesma sessão, a sequência é a
  // referência principal; o relógio só desempata quando a sequência não existe.
  if (previous && source === "broadcast") {
    const sameSession = Boolean(sessionId && sessionId === previous.sessionId);
    if (sameSession && hasSequence && rawSequence <= previous.lastSequence) return;
    if ((!sameSession || !hasSequence) && sentAt > 0 &&
        previous.lastPositionAt > 0 && sentAt <= previous.lastPositionAt) return;
    // Não deixa uma aba antiga, sem identificador/ordem, sobrescrever uma
    // conexão nova que já está enviando pacotes versionados.
    if (previous.sessionId && !sessionId && !hasSequence && !sentAt) return;
  }

  const acceptedX = staleDatabasePosition ? (previous.targetX ?? previous.x) : x;
  const acceptedY = staleDatabasePosition ? (previous.targetY ?? previous.y) : y;
  const acceptedDirection = staleDatabasePosition
    ? previous.direction
    : (Number.isFinite(Number(payload.direction)) ? Math.max(0, Math.min(3, Number(payload.direction))) : 2);
  const hasCharacter = payload.character && Object.keys(payload.character).length > 0;
  state.remote.set(id, {
    id,
    display_name: String(payload.display_name || payload.displayName || previous?.display_name || "Aventureiro").slice(0, 24),
    displayName: String(payload.display_name || payload.displayName || previous?.displayName || "Aventureiro").slice(0, 24),
    x: acceptedX, y: acceptedY, targetX: acceptedX, targetY: acceptedY,
    direction: acceptedDirection,
    character: hasCharacter ? payload.character : (previous?.character || {}),
    wearables: payload.wearables && Object.keys(payload.wearables).length
      ? payload.wearables
      : (previous?.wearables || {}),
    combatStats: payload.combat_stats || previous?.combatStats || {},
    type: "player",
    lastUpdate: Date.now(),
    sessionId: sessionId || previous?.sessionId || "",
    lastSequence: hasSequence ? rawSequence :
      (sessionId && sessionId !== previous?.sessionId ? -1 : (previous?.lastSequence ?? -1)),
    lastPositionAt: (source === "broadcast" || isDatabasePosition)
      ? Math.max(previous?.lastPositionAt || 0, sentAt || 0)
      : (previous?.lastPositionAt || 0)
  });
  updateRemotes();
}

function acceptCombat() {
  // Combat, dano e projéteis só são aceitos quando chegam como estado do banco.
}

function broadcastCombat(action = {}) {
  if (!state.online || !state.joined || !state.channel || !state.user) return false;
  const local = readLocal();
  if (!local || !action || typeof action !== "object") return false;
  const packet = {
    ...action,
    user_id: state.user.id,
    display_name: state.displayName,
    x: local.x, y: local.y,
    direction: Number.isFinite(Number(action.direction))
      ? Math.max(0, Math.min(3, Number(action.direction)))
      : local.direction,
    character: local.character,
    wearables: local.wearables,
    combat_stats: local.combat_stats || {},
    session_id: state.sessionId,
    event_id: state.sessionId + ":combat:" + (++state.combatSequence),
    sent_at: Date.now()
  };
  void state.channel.send({ type: "broadcast", event: "combat", payload: packet })
    .then(result => {
      if (result?.status && result.status !== "ok") console.warn("KTK combat broadcast:", result.status);
    })
    .catch(error => console.warn("KTK combat broadcast:", error));
  return true;
}

function rebuildPresence() {
  if (!state.channel) return;
  const presence = state.channel.presenceState();
  const active = new Set();
  Object.values(presence).flat().forEach(entry => {
    if (!entry?.user_id || entry.user_id === state.user?.id) return;
    active.add(String(entry.user_id));
    // Um sync de presença não deve substituir coordenadas já recebidas por broadcast.
    acceptRemote(entry, "presence");
  });
  // Falhas momentâneas no Presence não removem entidades do estado compartilhado.
  updateRemotes();
}

async function loadExistingPlayers() {
  const cutoff = new Date(Date.now() - 30000).toISOString();
  const { data, error } = await supabase
    .from("ktk_world_players")
    .select("user_id,x,y,direction,is_alive,last_seen_at,position_updated_at")
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
      position_updated_at: row.position_updated_at,
      display_name: profile.display_name, character: profile.character
    }, "database-snapshot");
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
    .on("broadcast", { event: "ENTITY_INSERT" }, ({ payload }) => acceptWorldEntityChange(payload))
    .on("broadcast", { event: "ENTITY_UPDATE" }, ({ payload }) => acceptWorldEntityChange(payload))
    .on("broadcast", { event: "ENTITY_DELETE" }, ({ payload }) => acceptWorldEntityChange(payload,true))
    .on("presence", { event: "sync" }, rebuildPresence)
    .on("presence", { event: "join" }, rebuildPresence)
    .on("presence", { event: "leave" }, ({key}) => {
      rebuildPresence();
      const id=String(key||"");
      setTimeout(()=>{
        if(!id || state.channel?.presenceState()?.[id]?.length) return;
        state.remote.delete(id);
        updateRemotes();
      },15000);
    });

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
  await loadWorldState();
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
  const appearanceSignature = JSON.stringify({
    character: payload.character || {},
    wearables: payload.wearables || {},
    combatStats: payload.combat_stats || {}
  });
  const appearanceChanged = appearanceSignature !== state.lastAppearanceSignature;
  const moved = !previous || Math.hypot(payload.x - previous.x, payload.y - previous.y) > 0.35 ||
    payload.direction !== previous.direction;

  if ((moved || appearanceChanged) && (force || appearanceChanged || now - state.lastSent >= 90)) {
    state.lastSent = now;
    state.lastAppearanceSignature = appearanceSignature;
    // A posição só é considerada confirmada depois da resposta do banco.
  }

  if (appearanceChanged) void trackPresence();
  if (now - state.lastTrack >= 10000) void trackPresence();
  if (now - state.lastDbHeartbeat >= 10000) {
    state.lastDbHeartbeat = now;
    void supabase.rpc("ktk_touch_player").then(({error})=>{
      if(error) console.warn("KTK world heartbeat:",error.message);
    });
  }
  // Garante que o servidor registre caminhada/corrida antes de validar
  // a próxima posição. Uma intenção ainda pendente nunca pode ser ultrapassada
  // por um checkpoint que dependa dela.
  if (state.intentInFlight) return;
  const intentSignature = JSON.stringify({ moving: payload.moving, running: payload.running, guarding: payload.guarding });
  if (intentSignature !== state.lastIntentSignature) {
    state.lastIntentSignature = intentSignature;
    state.intentInFlight = true;
    const { error: intentError } = await supabase.rpc("ktk_game_action", {
      p_action: "intent",
      p_payload: {
        moving: Boolean(payload.moving),
        running: Boolean(payload.running),
        guarding: Boolean(payload.guarding)
      }
    });
    state.intentInFlight = false;
    if (intentError) {
      console.warn("KTK authoritative intent:", intentError.message);
      state.lastIntentSignature = "";
      return;
    }
  }

  if ((moved || force) && now - state.lastCheckpoint >= 90 && !state.positionInFlight) {
    state.lastCheckpoint = now;
    state.positionInFlight = true;
    try {
      const { data: checkpoint, error: checkpointError } = await supabase.rpc("ktk_checkpoint_player", {
        p_x: payload.x, p_y: payload.y, p_direction: payload.direction
      });
      if (checkpointError) {
        console.warn("KTK authoritative movement:", checkpointError.message);
        return;
      }
      if (checkpoint && Number.isFinite(Number(checkpoint.x)) && Number.isFinite(Number(checkpoint.y))) {
        const serverX=Number(checkpoint.x), serverY=Number(checkpoint.y);
        const dx=serverX-payload.x, dy=serverY-payload.y;
        if(checkpoint.accepted===false || Math.hypot(dx,dy)>1.5) {
          window.KTKWorldEntities?.setLocalState?.(serverX,serverY,checkpoint.direction);
        }
        state.lastPosition={x:serverX,y:serverY,direction:Number(checkpoint.direction)};
      }
    } finally {
      state.positionInFlight = false;
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

    let sessionData;
    if (options.newCharacter) {
      // Morte é permanente: a nova tentativa recebe um auth.uid() totalmente novo.
      // O servidor remove o histórico morto deste nome quando o personagem é recriado.
      if (state.channel) {
        try { await supabase.removeChannel(state.channel); } catch (cleanupError) {
          console.warn("KTK old session cleanup:", cleanupError);
        }
        state.channel = null;
      }
      const { data: previousSession, error: previousSessionError } = await supabase.auth.getSession();
      if (previousSessionError) throw previousSessionError;
      if (previousSession?.session) {
        const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
        const { data: afterSignOut, error: afterSignOutError } = await supabase.auth.getSession();
        if (afterSignOutError) throw afterSignOutError;
        if (afterSignOut?.session) {
          throw signOutError || new Error("Não foi possível encerrar a conta anterior para criar outra.");
        }
        if (signOutError) console.warn("KTK old anonymous session was cleared locally:",signOutError.message);
      }
      const result = await supabase.auth.signInAnonymously();
      if (result.error) throw new Error("Não foi possível criar outra conta de jogador. Confira se o login anônimo está ativado no Supabase: " + result.error.message);
      sessionData = { session: result.data.session };
    } else {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      sessionData = data;
      if (!sessionData.session) {
        const result = await supabase.auth.signInAnonymously();
        if (result.error) throw new Error("Não foi possível criar sua conta de jogador. Confira se o login anônimo está ativado no Supabase: " + result.error.message);
        sessionData = { session: result.data.session };
      }
    }
    state.user = sessionData.session.user;

    let player;
    if (options.newCharacter) {
      const { data, error } = await supabase.rpc("ktk_create_new_character", {
        p_display_name: displayName, p_character: options.character || {}
      });
      if (error) throw error;
      player = data?.player;
    } else {
      const { data, error } = await supabase.rpc("ktk_join_world", {
        p_display_name: displayName, p_character: options.character || {}
      });
      if (error) throw error;
      player = data?.player;
    }
    if (player?.is_alive) {
      try { player.state = (await getPlayerState()).state; } catch (stateError) { console.warn("KTK initial player state:", stateError); }
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
    state.lastPosition = null;
    state.lastIntentSignature = "";
    updateRemotes();
    const code = error?.code || error?.error_code || "";
    const message = String(error?.message || "");
    if (message.includes("CHARACTER_DEAD_NEW_ACCOUNT_REQUIRED")) {
      return {
        ok: false, dead: true,
        error: "Este personagem morreu permanentemente. Crie outra conta para começar do zero."
      };
    }
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

async function getPlayerState() {
  const { data, error } = await supabase.rpc("ktk_get_player_state");
  if (error) throw error;
  return data;
}

async function gameAction(action, payload = {}) {
  const { data, error } = await supabase.rpc("ktk_game_action", {
    p_action: String(action),
    p_payload: payload || {}
  });
  if (error) throw error;
  if (data?.state) window.KTKWorldEntities?.applyServerState?.(data.state);
  await loadWorldState();
  return data;
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
  state.lastPosition = null;
  state.lastIntentSignature = "";
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

async function claimKingCrown() {
  const {data,error}=await supabase.rpc("ktk_claim_king_crown");
  if(error) return {ok:false,error:error.message||"Não foi possível reivindicar a coroa."};
  await loadWorldState();
  return {ok:true,data};
}

async function dropKingCrown(x,y) {
  const {data,error}=await supabase.rpc("ktk_drop_king_crown",{p_x:Number(x),p_y:Number(y)});
  if(error) return {ok:false,error:error.message||"Não foi possível soltar a coroa."};
  await loadWorldState();
  return {ok:true,data};
}

window.KTKOnline = {
  enter, markDead, broadcastCombat, claimKingCrown, dropKingCrown, getPlayerState, gameAction,
  get userId() { return state.user?.id || null; },
  get connected() { return state.online; }
};

document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("ktk-display-name");
  if (input) input.value = localStorage.getItem("ktk-display-name") || "";
  startHeartbeat();
});
