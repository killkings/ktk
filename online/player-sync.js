/* Perfis remotos, entidades recebidas e sincronização dos jogadores. */
import { state } from "./state.js?v=20261117-websocket-world-001";
import { supabase, WORLD_ID } from "./supabase-client.js?v=20261117-websocket-world-001";
import { applyOwnServerPosition } from "./movement.js?v=20261117-websocket-world-001";

// Ordena timestamps timestamptz incluindo os microssegundos do PostgreSQL.
function compareServerTimestamps(a, b) {
  const leftText=String(a||"");
  const rightText=String(b||"");
  const leftMs=Date.parse(leftText), rightMs=Date.parse(rightText);
  if(Number.isFinite(leftMs)&&Number.isFinite(rightMs)) {
    const fraction=value=>Number((String(value).match(/\.(\d+)(?=(?:Z|[+-]\d{2}:?\d{2})$)/i)?.[1]||"").padEnd(6,"0").slice(3,6)||0);
    const left=leftMs*1000+fraction(leftText);
    const right=rightMs*1000+fraction(rightText);
    return left===right?0:(left<right?-1:1);
  }
  if(!leftText) return rightText?-1:0;
  if(!rightText) return 1;
  return leftText===rightText?0:(leftText<rightText?-1:1);
}

function mergeRemoteAppearance(current, incoming, options = {}) {
  const contract = window.KTKRemoteAppearance;
  if (contract?.merge) return contract.merge(current, incoming, options);
  const previous = current || {};
  const next = incoming || {};
  return {
    character: next.character && Object.keys(next.character).length
      ? next.character : (previous.character || {}),
    wearables: next.wearables && Object.keys(next.wearables).length
      ? next.wearables : (previous.wearables || {})
  };
}

export function updateRemotes() {
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
  const profileCharacter=profile.character&&typeof profile.character==="object"?profile.character:{};
  const mergedAppearance=mergeRemoteAppearance(remote,{character:profileCharacter},{fillCharacter:true});
  if(mergedAppearance.character!==remote.character) {
    remote.character=mergedAppearance.character;
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
  const sessionId=state.sessionId;
  if(!id||!state.user||state.leaving) return Promise.resolve(null);
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
      if(sessionId!==state.sessionId||!state.user||state.leaving) return null;
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

export function acceptWorldEntityChange(payload, deleted = false) {
  if(!state.user||state.leaving) return;
  const row=payload?.record||payload?.new||payload?.old||payload;
  if(row?.entity_id) window.KTKWorldEntities?.applyWorldEntity?.({...row,deleted});
}

export function acceptDatabaseChange(payload) {
  if(!state.user||state.leaving) return;
  const row = payload?.new || payload?.record || payload;
  if (!row?.user_id) return;
  if (row.user_id === state.user?.id) {
    if (row.state) window.KTKWorldEntities?.applyServerState?.(row.state);
    // A posição contínua vem das respostas RPC. Um golpe é um deslocamento
    // discreto do servidor e só entra se seu timestamp superar a posição atual.
    const knockbackAt=String(row.state?.last_knockback_at||"");
    if (row.is_alive !== false && knockbackAt && knockbackAt!==state.lastLocalKnockbackAt) {
      state.lastLocalKnockbackAt=knockbackAt;
      applyOwnServerPosition(row,Number(state.lastMovementLatencyMs)||0);
      window.KTKWorldEntities?.applyServerKnockback?.(row.state?.last_knockback);
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
    wearables: serverState.wearables,
    moving:serverState.moving,
    running:serverState.running,
    guarding:serverState.guarding,
    movementInputX:serverState.movement_input_x,
    movementInputY:serverState.movement_input_y,
    combat_stats: {
      health:serverState.health,maxHealth:serverState.max_health,
      stamina:serverState.stamina,maxStamina:serverState.max_stamina,
      satiety:serverState.satiety,maxSatiety:99,
      hydration:serverState.hydration,maxHydration:99
    }
  }, state.gameSocketConnected ? "presence" : "database");
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
    const appearance=mergeRemoteAppearance(previous,payload);
    const next={
      ...previous,
      display_name:String(payload.display_name||payload.displayName||previous.display_name||"Aventureiro").slice(0,24),
      displayName:String(payload.display_name||payload.displayName||previous.displayName||"Aventureiro").slice(0,24),
      character:appearance.character,
      wearables:appearance.wearables,
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
  const positionTimestamp = String(payload.position_updated_at || "");
  const databasePositionAt = positionTimestamp ? Date.parse(positionTimestamp) : 0;
  const sentAt = Number(payload.sent_at) || (Number.isFinite(databasePositionAt) ? databasePositionAt : 0);
  const isDatabasePosition = source === "database" || source === "database-snapshot";
  const previousPositionTimestamp = String(previous?.lastPositionTimestamp || "");
  const timestampOrder = positionTimestamp && previousPositionTimestamp
    ? compareServerTimestamps(positionTimestamp, previousPositionTimestamp)
    : null;
  const staleDatabasePosition = Boolean(previous && isDatabasePosition && (
    previousPositionTimestamp
      ? (!positionTimestamp || timestampOrder <= 0)
      : (sentAt > 0 && previous.lastPositionAt > 0 && sentAt < previous.lastPositionAt)
  ));

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
  const appearance=mergeRemoteAppearance(previous,payload,{
    authoritativeWearables:isDatabasePosition && payload.wearables && typeof payload.wearables==="object"
  });
  let velocityX=Number(previous?.velocityX)||0;
  let velocityY=Number(previous?.velocityY)||0;
  let positionReceivedAt=Number(previous?.positionReceivedAt)||0;
  let serverMoving=Boolean(previous?.serverMoving);
  const isGameServerPosition = source === "game-server";
  const acceptedNewPosition=isDatabasePosition&&!staleDatabasePosition&&Boolean(positionTimestamp);
  if(isGameServerPosition) {
    positionReceivedAt=performance.now();
    serverMoving=Boolean(payload.moving);
    velocityX=Number.isFinite(Number(payload.velocityX))?Number(payload.velocityX):0;
    velocityY=Number.isFinite(Number(payload.velocityY))?Number(payload.velocityY):0;
  } else if(acceptedNewPosition) {
    positionReceivedAt=performance.now();
    serverMoving=Boolean(payload.moving);
    if(!serverMoving) {
      velocityX=0;
      velocityY=0;
    } else if(previous&&previousPositionTimestamp) {
      const previousAt=Date.parse(previousPositionTimestamp);
      const currentAt=Date.parse(positionTimestamp);
      const elapsedMs=currentAt-previousAt;
      if(Number.isFinite(elapsedMs)&&elapsedMs>=30&&elapsedMs<=2500) {
        velocityX=(acceptedX-Number(previous.x||0))/(elapsedMs/1000);
        velocityY=(acceptedY-Number(previous.y||0))/(elapsedMs/1000);
        const speed=Math.hypot(velocityX,velocityY);
        const maxSpeed=420;
        if(speed>maxSpeed) {
          velocityX*=maxSpeed/speed;
          velocityY*=maxSpeed/speed;
        }
      } else {
        const inputX=Number(payload.movementInputX)||0;
        const inputY=Number(payload.movementInputY)||0;
        const inputLength=Math.hypot(inputX,inputY);
        if(serverMoving&&inputLength>0) {
          const baseSpeed=225*(payload.running?1.5:1)*(payload.guarding?0.5:1);
          velocityX=inputX/inputLength*baseSpeed;
          velocityY=inputY/inputLength*baseSpeed;
        } else {
          velocityX=0;
          velocityY=0;
        }
      }
    } else {
      const inputX=Number(payload.movementInputX)||0;
      const inputY=Number(payload.movementInputY)||0;
      const inputLength=Math.hypot(inputX,inputY);
      if(serverMoving&&inputLength>0) {
        // Primeiro snapshot: usa a intenção do servidor até haver duas
        // posições oficiais para medir a velocidade real.
        const baseSpeed=225*(payload.running?1.5:1)*(payload.guarding?0.5:1);
        velocityX=inputX/inputLength*baseSpeed;
        velocityY=inputY/inputLength*baseSpeed;
      } else {
        velocityX=0;
        velocityY=0;
      }
    }
  }
  state.remote.set(id, {
    id,
    display_name: String(payload.display_name || payload.displayName || previous?.display_name || "Aventureiro").slice(0, 24),
    displayName: String(payload.display_name || payload.displayName || previous?.displayName || "Aventureiro").slice(0, 24),
    x: acceptedX, y: acceptedY, targetX: acceptedX, targetY: acceptedY,
    direction: acceptedDirection,
    character: appearance.character,
    wearables: appearance.wearables,
    combatStats: payload.combat_stats || previous?.combatStats || {},
    velocityX,velocityY,positionReceivedAt,serverMoving,
    type: "player",
    lastUpdate: Date.now(),
    sessionId: sessionId || previous?.sessionId || "",
    lastSequence: hasSequence ? rawSequence :
      (sessionId && sessionId !== previous?.sessionId ? -1 : (previous?.lastSequence ?? -1)),
    lastPositionAt: (source === "broadcast" || isDatabasePosition)
      ? Math.max(previous?.lastPositionAt || 0, sentAt || 0)
      : (previous?.lastPositionAt || 0),
    lastPositionTimestamp: isDatabasePosition
      ? (staleDatabasePosition
        ? (previous?.lastPositionTimestamp || "")
        : (positionTimestamp || previous?.lastPositionTimestamp || ""))
      : (previous?.lastPositionTimestamp || ""),
    positionUpdatedAt: isGameServerPosition
      ? String(payload.position_updated_at || payload.sequence || "")
      : (isDatabasePosition
        ? (staleDatabasePosition
          ? (previous?.lastPositionTimestamp || "")
          : (positionTimestamp || previous?.lastPositionTimestamp || ""))
        : (previous?.positionUpdatedAt || previous?.lastPositionTimestamp || "")),
    transport: isGameServerPosition ? "game-server" : (previous?.transport || "database")
  });
  updateRemotes();
  void loadRemoteProfile(id);
}

export function acceptGameServerPlayers(players, tick, serverEpoch) {
  const currentIds = new Set();
  const sequence = Math.max(0, Math.trunc(Number(tick) || 0));
  const sessionId = String(serverEpoch || "game-server");
  (Array.isArray(players) ? players : []).forEach(player => {
    const id = String(player?.user_id || "");
    if (!id || id === state.user?.id) return;
    currentIds.add(id);
    acceptRemote({
      user_id: id, x: player.x, y: player.y, direction: player.direction,
      display_name: player.display_name, character: player.character,
      wearables: player.wearables, combat_stats: player.combat_stats,
      moving: player.moving, running: player.running, guarding: player.guarding,
      velocityX: player.velocityX, velocityY: player.velocityY,
      sequence, session_id: sessionId,
      position_updated_at: sessionId + ":" + sequence
    }, "game-server");
  });
  for (const id of state.remote.keys()) if (!currentIds.has(id)) state.remote.delete(id);
  updateRemotes();
}

window.KTKRemoteSync = { acceptGameServerPlayers };

export function rebuildPresence() {
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

export async function loadExistingPlayers(signal) {
  const sessionId=state.sessionId;
  const cutoff = new Date(Date.now() - 30000).toISOString();
  let request = supabase
    .from("ktk_world_players")
    .select("user_id,x,y,direction,is_alive,last_seen_at,position_updated_at,state")
    .eq("world_id", WORLD_ID)
    .eq("is_alive", true)
    .gte("last_seen_at", cutoff);
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw error;
  if(sessionId!==state.sessionId||!state.user||state.leaving) return;
  const rows = data || [];
  rows.forEach(row => {
    if(row.user_id===state.user?.id) return;
    const payload={
      user_id: row.user_id, x: row.x, y: row.y, direction: row.direction,
      position_updated_at: row.position_updated_at,
      display_name: "Aventureiro", character: {},
      moving:row.state?.moving,
      running:row.state?.running,
      guarding:row.state?.guarding,
      movementInputX:row.state?.movement_input_x,
      movementInputY:row.state?.movement_input_y,
      combat_stats: {
        health:row.state?.health,maxHealth:row.state?.max_health,
        stamina:row.state?.stamina,maxStamina:row.state?.max_stamina,
        satiety:row.state?.satiety,maxSatiety:99,
        hydration:row.state?.hydration,maxHydration:99
      }
    };
    if(row.state?.wearables && typeof row.state.wearables==="object") {
      payload.wearables=row.state.wearables;
    }
    acceptRemote(payload, "database-snapshot");
  });
}

export function resetPlayerSyncState() {
  state.remote.clear();
  state.profileCache.clear();
  state.profileLoads.clear();
  state.profileRetryTimers.forEach(timer => clearTimeout(timer));
  state.profileRetryTimers.clear();
  state.profileRetryCounts.clear();
  state.seenCombatEvents.clear();
  state.lastLocalKnockbackAt = "";
}
