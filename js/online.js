import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm";

const SUPABASE_URL = "https://mtddtvqtljtgzggpdogl.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_U5CdIRdPg0Brfn7x2Bj2hQ_VCXjwRQH";
const WORLD_ID = "main";
const TOPIC = "world:main";
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: true,
    detectSessionInUrl: false
  },
  realtime: { params: { eventsPerSecond: 20 } }
});

const state = {
  user: null, accessToken: "", channel: null, joined: false, online: false,
  leaving: false,
  displayName: "", lastSent: 0, lastCheckpoint: 0, lastTrack: 0, lastDbHeartbeat: 0,
  lastPosition: null, lastIntentSignature: "", lastInputSignature: "",
  stepInFlight: false, stepController: null, stepSequence: 0, activeStepId: 0,
  sessionId: window.crypto?.randomUUID?.() || (String(Date.now()) + "-" + Math.random().toString(36).slice(2)),
  remote: new Map(), profileCache: new Map(), profileLoads: new Map(),
  profileRetryTimers: new Map(), profileRetryCounts: new Map(), seenCombatEvents: new Set(),
  lastLocalKnockbackAt: "", intentInFlight: false, worldStateRequestId: 0, connecting: false
};
supabase.auth.onAuthStateChange((_event,session)=>{
  state.accessToken=session?.access_token||"";
});

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

function readControlInput() {
  const data = window.KTKWorldEntities?.getLocalControls?.();
  if (!data) return null;
  return {
    inputX: Number.isFinite(Number(data.inputX)) ? Math.max(-1, Math.min(1, Math.trunc(Number(data.inputX)))) : 0,
    inputY: Number.isFinite(Number(data.inputY)) ? Math.max(-1, Math.min(1, Math.trunc(Number(data.inputY)))) : 0,
    running: Boolean(data.running),
    guarding: Boolean(data.guarding)
  };
}

function updateRemotes() {
  if (window.KTKWorldEntities?.setRemotePlayers) {
    window.KTKWorldEntities.setRemotePlayers([...state.remote.values()]);
  }
}

function applyRemoteProfile(userId, profile) {
  const id=String(userId||"");
  const remote=state.remote.get(id);
  if(!remote||!profile) return false;
  let changed=false;
  const profileName=String(profile.display_name||"").trim();
  if(profileName && (!remote.displayName || remote.displayName==="Aventureiro")) {
    remote.displayName=profileName.slice(0,24);
    remote.display_name=remote.displayName;
    changed=true;
  }
  const currentCharacter=remote.character&&typeof remote.character==="object"?remote.character:{};
  const profileCharacter=profile.character&&typeof profile.character==="object"?profile.character:{};
  if(!Object.keys(currentCharacter).length && Object.keys(profileCharacter).length) {
    remote.character=profileCharacter;
    changed=true;
  }
  if(changed) updateRemotes();
  return changed;
}

function scheduleRemoteProfileRetry(userId) {
  const id=String(userId||"");
  if(!id||state.profileRetryTimers.has(id)||!state.remote.has(id)) return;
  const attempt=state.profileRetryCounts.get(id)||0;
  const delays=[1000,2500,5000,10000,20000,30000];
  const delay=delays[Math.min(attempt,delays.length-1)];
  state.profileRetryCounts.set(id,attempt+1);
  const timer=setTimeout(()=>{
    state.profileRetryTimers.delete(id);
    if(state.remote.has(id)) void loadRemoteProfile(id);
  },delay);
  state.profileRetryTimers.set(id,timer);
}

function loadRemoteProfile(userId) {
  const id=String(userId||"");
  if(!id) return Promise.resolve(null);
  const cached=state.profileCache.get(id);
  if(cached) {
    applyRemoteProfile(id,cached);
    return Promise.resolve(cached);
  }
  const pending=state.profileLoads.get(id);
  if(pending) return pending;

  const request=(async()=>{
    try {
      const {data,error}=await supabase.from("ktk_profiles")
        .select("display_name,character")
        .eq("id",id)
        .maybeSingle();
      if(error) throw error;
      if(!data) throw new Error("Perfil do jogador não encontrado.");
      const profile={
        display_name:data.display_name||"",
        character:data.character&&typeof data.character==="object"?data.character:{}
      };
      state.profileCache.set(id,profile);
      state.profileRetryCounts.delete(id);
      const retryTimer=state.profileRetryTimers.get(id);
      if(retryTimer) clearTimeout(retryTimer);
      state.profileRetryTimers.delete(id);
      applyRemoteProfile(id,profile);
      return profile;
    } catch(error) {
      console.warn("KTK profile load:",id,error?.message||error);
      scheduleRemoteProfileRetry(id);
      return null;
    } finally {
      if(state.profileLoads.get(id)===request) state.profileLoads.delete(id);
    }
  })();
  state.profileLoads.set(id,request);
  return request;
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
    wearables: serverState.wearables || {},
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
  void loadRemoteProfile(row.user_id);
}

function acceptRemote(payload, source = "broadcast") {
  if (!payload || !payload.user_id || payload.user_id === state.user?.id) return;
  const x = Number(payload.x), y = Number(payload.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const id = String(payload.user_id);
  const previous = state.remote.get(id);

  // Presence atualiza aparência imediatamente, mas não substitui posição
  // recebida do banco (que é a coordenada oficial do mundo).
  if (previous && source === "presence") {
    const next={
      ...previous,
      display_name:String(payload.display_name||payload.displayName||previous.display_name||"Aventureiro").slice(0,24),
      displayName:String(payload.display_name||payload.displayName||previous.displayName||"Aventureiro").slice(0,24),
      character:payload.character&&Object.keys(payload.character).length
        ? payload.character : (previous.character||{}),
      wearables:payload.wearables&&Object.keys(payload.wearables).length
        ? payload.wearables : (previous.wearables||{}),
      combatStats:payload.combat_stats||previous.combatStats||{}
    };
    state.remote.set(id,next);
    updateRemotes();
    void loadRemoteProfile(id);
    return;
  }

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
  void loadRemoteProfile(id);
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
    .select("user_id,x,y,direction,is_alive,last_seen_at,position_updated_at,state")
    .eq("world_id", WORLD_ID)
    .eq("is_alive", true)
    .gte("last_seen_at", cutoff);
  if (error) throw error;
  const rows = data || [];
  rows.forEach(row => {
    if(row.user_id===state.user?.id) return;
    acceptRemote({
      user_id: row.user_id, x: row.x, y: row.y, direction: row.direction,
      position_updated_at: row.position_updated_at,
      display_name: "Aventureiro", character: {},
      wearables: row.state?.wearables || {},
      combat_stats: {
        health:row.state?.health,maxHealth:row.state?.max_health,
        stamina:row.state?.stamina,maxStamina:row.state?.max_stamina,
        satiety:row.state?.satiety,maxSatiety:99,
        hydration:row.state?.hydration,maxHydration:99
      }
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
  if (state.leaving || !state.channel || !state.online || !state.joined || !state.user) return;
  const { error } = await state.channel.track({
    user_id: state.user.id,
    session_id: state.sessionId
  });
  if (error) console.warn("KTK presence:", error.message);
  state.lastTrack = Date.now();
}

async function sendPosition(force = false) {
  if (state.leaving || !state.online || !state.channel || !state.joined) return;
  const payload = readControlInput();
  if (!payload) return;

  const now = Date.now();
  const inputX = Math.max(-1, Math.min(1, Math.trunc(Number(payload.inputX) || 0)));
  const inputY = Math.max(-1, Math.min(1, Math.trunc(Number(payload.inputY) || 0)));
  const moving = inputX !== 0 || inputY !== 0;
  const running = Boolean(payload.running) && moving;
  const guarding = Boolean(payload.guarding);
  const inputSignature = JSON.stringify({ inputX, inputY, running, guarding });
  const inputChanged = inputSignature !== state.lastInputSignature;

  // O cliente envia somente a intenção de movimento. A posição, a velocidade
  // e as colisões são calculadas no banco, a partir da posição já registrada.
  const shouldStep = inputChanged || (moving && now - state.lastCheckpoint >= 90) || force;
  if (!shouldStep || state.stepInFlight) return;
  if (state.leaving || !state.online || !state.joined) return;

  state.stepInFlight = true;
  state.lastCheckpoint = now;
  const stepId = ++state.stepSequence;
  state.activeStepId = stepId;
  const stepController = new AbortController();
  state.stepController = stepController;
  const stepTimeout = setTimeout(() => stepController.abort(), 900);

  try {
    const { data: step, error } = await supabase.rpc("ktk_step_player", {
      p_input_x: inputX,
      p_input_y: inputY,
      p_running: running,
      p_guarding: guarding
    }).abortSignal(stepController.signal);

    if (stepId !== state.stepSequence) return;
    if (error) {
      state.lastInputSignature = "";
      console.warn("KTK server movement:", error.message);
      return;
    }
    if (state.leaving || !state.online || !state.joined) return;

    state.lastInputSignature = inputSignature;
    if (step && Number.isFinite(Number(step.x)) && Number.isFinite(Number(step.y))) {
      const serverX = Number(step.x);
      const serverY = Number(step.y);
      const direction = Number.isFinite(Number(step.direction))
        ? Math.max(0, Math.min(3, Number(step.direction)))
        : payload.direction;
      state.lastPosition = {
        x: serverX,
        y: serverY,
        direction,
        lastPositionAt: Date.now()
      };
      window.KTKWorldEntities?.reconcileLocalPosition?.(serverX, serverY, direction);
    }
  } catch (error) {
    if (stepId === state.stepSequence) {
      state.lastInputSignature = "";
      if (error?.name === "AbortError") {
        console.warn("KTK server movement: request timed out; the next heartbeat will retry.");
      } else {
        console.warn("KTK server movement:", error?.message || error);
      }
    }
  } finally {
    clearTimeout(stepTimeout);
    if (state.stepController === stepController) state.stepController = null;
    if (state.activeStepId === stepId) {
      state.activeStepId = 0;
      state.stepInFlight = false;
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
    state.accessToken = sessionData.session.access_token || state.accessToken;
    state.leaving = false;

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
    void trackPresence();
    state.lastInputSignature = "";
    state.lastCheckpoint = 0;
    state.stepInFlight = false;
    state.stepController = null;
    state.activeStepId = 0;
    state.stepSequence++;
    void setPlayerVisibility(document.visibilityState === "visible");
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
    state.lastInputSignature = "";
    state.stepController?.abort();
    state.stepController = null;
    state.stepSequence++;
    state.activeStepId = 0;
    state.stepInFlight = false;
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
  try {
    await loadWorldState();
  } catch (snapshotError) {
    // Ação confirmada pelo RPC não deve parecer rejeitada só porque a
    // fotografia complementar do mundo falhou na rede.
    console.warn("KTK world snapshot after action:",snapshotError);
  }
  return data;
}

async function clearLocalSession(statusMessage) {
  state.leaving = true;
  state.stepSequence++;
  state.activeStepId = 0;
  state.stepInFlight = false;
  state.stepController?.abort();
  state.stepController = null;

  const channel = state.channel;
  state.channel = null;
  if (channel) {
    try { await supabase.removeChannel(channel); }
    catch (error) { console.warn("KTK channel cleanup:", error?.message || error); }
  }

  state.online = false;
  state.joined = false;
  state.user = null;
  state.accessToken = "";
  state.displayName = "";
  state.lastPosition = null;
  state.lastIntentSignature = "";
  state.lastInputSignature = "";
  state.lastCheckpoint = 0;
  state.lastDbHeartbeat = 0;
  state.lastTrack = 0;
  state.remote.clear();
  state.profileCache.clear();
  state.profileLoads.clear();
  state.profileRetryTimers.forEach(timer => clearTimeout(timer));
  state.profileRetryTimers.clear();
  state.profileRetryCounts.clear();
  state.seenCombatEvents.clear();
  state.sessionId = "";

  try {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) console.warn("KTK in-memory sign-out:", error.message);
  } catch (error) {
    console.warn("KTK in-memory sign-out:", error?.message || error);
  }

  state.leaving = false;
  updateRemotes();
  setStatus(statusMessage || "○ Sessão encerrada · fora do mundo", false);
}

async function markDead() {
  if (!state.user) return;
  const { error } = await supabase.rpc("ktk_mark_dead");
  if (error) {
    const { data, error: stateError } = await supabase.rpc("ktk_get_player_state");
    if (stateError || data?.is_alive !== false) throw error;
  }
  await clearLocalSession("○ Personagem morto · sessão apagada");
}

// Saída voluntária encerra a vida no banco antes de desligar a sessão multiplayer.
// A identidade Auth só é trocada quando o jogador escolhe criar o próximo personagem.
async function leaveWorld() {
  if (state.leaving) return { ok: false, error: "A saída do mundo já está sendo processada." };
  if (!state.user) return { ok: false, error: "Não há uma sessão de jogador ativa para encerrar." };

  state.leaving = true;
  state.stepSequence++;
  state.activeStepId = 0;
  state.stepInFlight = false;
  state.stepController?.abort();
  state.stepController = null;
  try {
    const { data, error } = await supabase.rpc("ktk_leave_world");
    if (error) throw error;
    if (data && data.ok === false) throw new Error("O servidor não confirmou a morte do personagem.");

    await clearLocalSession("○ Personagem morto ao sair · sessão apagada");
    return { ok: true, data };
  } catch (error) {
    state.leaving = false;
    console.error("KTK voluntary exit:", error);
    return {
      ok: false,
      error: error?.message || "Não foi possível encerrar o personagem no servidor."
    };
  }
}

async function setPlayerVisibility(visible) {
  if (state.leaving || !state.online || !state.joined || !state.user) return;
  try {
    const { error } = await supabase.rpc("ktk_set_player_visibility", {
      p_visible: Boolean(visible)
    });
    if (error) console.warn("KTK player visibility:", error.message);
  } catch (error) {
    console.warn("KTK player visibility:", error?.message || error);
  }
}

function startHeartbeat() {
  document.addEventListener("visibilitychange", () => {
    if (!state.online || !state.joined || state.leaving) return;
    void setPlayerVisibility(document.visibilityState === "visible");
  });
  setInterval(() => {
    if (!state.online || !state.joined) return;
    void sendPosition(false).catch(error=>console.warn("KTK position heartbeat:",error));
  }, 100);
  window.addEventListener("pagehide", () => {
    // Mesmo se uma saída pelo Esc já começou, pagehide envia uma segunda
    // solicitação idempotente keepalive como proteção contra fechamento da página.
    if (!state.online || !state.joined || !state.accessToken) return;
    state.leaving = true;
    state.stepSequence++;
    state.stepController?.abort();
    state.stepController = null;
    state.activeStepId = 0;
    state.stepInFlight = false;
    const token = state.accessToken;
    const endpoint = SUPABASE_URL + "/rest/v1/rpc/ktk_leave_world";
    // keepalive permite que a requisição continue mesmo quando a página fecha.
    void fetch(endpoint, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      keepalive: true,
      headers: {
        "apikey": SUPABASE_PUBLISHABLE_KEY,
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
      },
      body: "{}"
    }).catch(error=>console.warn("KTK exit death:",error));
    state.joined = false;
    state.online = false;
    if (state.channel) void supabase.removeChannel(state.channel);
    state.channel = null;
    state.user = null;
    state.accessToken = "";
    state.displayName = "";
    state.remote.clear();
    state.profileCache.clear();
    state.profileRetryTimers.forEach(timer => clearTimeout(timer));
    state.profileRetryTimers.clear();
    void supabase.auth.signOut({ scope: "local" }).catch(error => {
      console.warn("KTK pagehide session cleanup:", error?.message || error);
    });
  }, {capture:true});
  window.addEventListener("pageshow", event => {
    if (event.persisted) window.location.reload();
  });
}

async function claimKingCrown() {
  const {data,error}=await supabase.rpc("ktk_claim_king_crown");
  if(error) return {ok:false,error:error.message||"Não foi possível reivindicar a coroa."};
  if(data?.state) window.KTKWorldEntities?.applyServerState?.(data.state);
  try { await loadWorldState(); }
  catch(snapshotError) { console.warn("KTK crown snapshot:",snapshotError); }
  return {ok:true,data};
}

async function dropKingCrown(x,y) {
  const {data,error}=await supabase.rpc("ktk_drop_king_crown",{p_x:Number(x),p_y:Number(y)});
  if(error) return {ok:false,error:error.message||"Não foi possível soltar a coroa."};
  try { await loadWorldState(); }
  catch(snapshotError) { console.warn("KTK crown snapshot:",snapshotError); }
  return {ok:true,data};
}

window.KTKOnline = {
  enter, markDead, leaveWorld, claimKingCrown, dropKingCrown, getPlayerState, gameAction,
  get userId() { return state.user?.id || null; },
  get connected() { return state.online; }
};

document.addEventListener("DOMContentLoaded", () => {
  // Apaga chaves gravadas por versões antigas do jogo. A identidade e o
  // personagem desta execução existem somente na memória desta página.
  try {
    localStorage.removeItem("ktk-display-name");
    localStorage.removeItem("sb-mtddtvqtljtgzggpdogl-auth-token");
  } catch (_) {}
  const input = document.getElementById("ktk-display-name");
  if (input) input.value = "";
  startHeartbeat();
});
