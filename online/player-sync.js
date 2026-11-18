/* Perfis remotos, entidades recebidas e sincronização dos jogadores. */
import { state } from "./state.js?v=20261117-walk-v1";
import { supabase, WORLD_ID } from "./supabase-client.js?v=20261117-walk-v1";

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
    // A caminhada contínua chega por Broadcast do navegador. Apenas um
    // knockback validado pelo servidor pode reposicionar o jogador local.
    const knockbackAt=String(row.state?.last_knockback_at||"");
    if (row.is_alive !== false && knockbackAt && knockbackAt!==state.lastLocalKnockbackAt) {
      state.lastLocalKnockbackAt=knockbackAt;
      window.KTKWorldEntities?.setLocalState?.(row.x,row.y,row.direction);
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
  }, "database-state");
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

  if (previous && source === "presence") {
    const appearance=mergeRemoteAppearance(previous,payload);
    state.remote.set(id,{
      ...previous,
      display_name:String(payload.display_name||payload.displayName||previous.display_name||"Aventureiro").slice(0,24),
      displayName:String(payload.display_name||payload.displayName||previous.displayName||"Aventureiro").slice(0,24),
      character:appearance.character,
      wearables:appearance.wearables,
      combatStats:payload.combat_stats||previous.combatStats||{}
    });
    updateRemotes();
    void loadRemoteProfile(id);
    return;
  }

  const sessionId=String(payload.session_id||"");
  const sequence=Number(payload.sequence);
  const hasSequence=Number.isSafeInteger(sequence)&&sequence>=0;
  const sentAt=Number(payload.sent_at)||Date.now();
  if(previous&&source==="broadcast") {
    const sameSession=Boolean(sessionId&&sessionId===previous.sessionId);
    if(sameSession&&hasSequence&&sequence<=previous.lastSequence) return;
    if(!sameSession&&sessionId&&previous.sessionId&&sessionId!==previous.sessionId) {
      // A nova sessão começa uma sequência independente.
    } else if(hasSequence&&previous.lastSequence>=0&&sequence<=previous.lastSequence) {
      return;
    } else if(!hasSequence&&sentAt<=Number(previous.lastPositionAt||0)) {
      return;
    }
  }

  const metadataOnly=source==="database-state"&&Boolean(previous);
  const acceptedX=metadataOnly?(Number(previous.targetX)||Number(previous.x)||x):x;
  const acceptedY=metadataOnly?(Number(previous.targetY)||Number(previous.y)||y):y;
  const acceptedDirection=metadataOnly
    ? (Number.isFinite(Number(previous.direction))?previous.direction:2)
    : (Number.isFinite(Number(payload.direction))?Math.max(0,Math.min(3,Number(payload.direction))):2);
  const appearance=mergeRemoteAppearance(previous,payload,{
    authoritativeWearables:source!=="broadcast"&&payload.wearables&&typeof payload.wearables==="object"
  });

  const remote={
    ...previous,
    id,
    display_name:String(payload.display_name||payload.displayName||previous?.display_name||"Aventureiro").slice(0,24),
    displayName:String(payload.display_name||payload.displayName||previous?.displayName||"Aventureiro").slice(0,24),
    x:acceptedX,y:acceptedY,targetX:acceptedX,targetY:acceptedY,
    direction:acceptedDirection,
    character:appearance.character,
    wearables:appearance.wearables,
    combatStats:payload.combat_stats||previous?.combatStats||{},
    serverMoving:metadataOnly?Boolean(previous?.serverMoving):Boolean(payload.moving),
    positionReceivedAt:performance.now(),
    type:"player",
    lastUpdate:Date.now(),
    sessionId:sessionId||previous?.sessionId||"",
    lastSequence:hasSequence?sequence:(sessionId&&sessionId!==previous?.sessionId?-1:(previous?.lastSequence??-1)),
    lastPositionAt:source==="broadcast"?Math.max(previous?.lastPositionAt||0,sentAt):(previous?.lastPositionAt||0),
    lastPositionTimestamp:source==="database-snapshot"
      ? String(payload.position_updated_at||""):(previous?.lastPositionTimestamp||""),
    positionUpdatedAt:source==="database-snapshot"
      ? String(payload.position_updated_at||""):(previous?.positionUpdatedAt||"")
  };
  state.remote.set(id,remote);
  updateRemotes();
  void loadRemoteProfile(id);
}

export function acceptMovementBroadcast(payload) {
  if(!state.user||state.leaving||!payload?.user_id) return;
  acceptRemote(payload,"broadcast");
}

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
