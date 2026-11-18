/* Estado compartilhado da sessão multiplayer. */
function createSessionId() {
  return window.crypto?.randomUUID?.() || (String(Date.now()) + "-" + Math.random().toString(36).slice(2));
}

export const state = {
  user: null,
  accessToken: "",
  channel: null,
  joined: false,
  online: false,
  leaving: false,
  connecting: false,
  displayName: "",
  sessionId: createSessionId(),
  remote: new Map(),
  profileCache: new Map(),
  profileLoads: new Map(),
  profileRetryTimers: new Map(),
  profileRetryCounts: new Map(),
  seenCombatEvents: new Set(),
  lastLocalKnockbackAt: "",
  worldStateRequestId: 0,
  lastPositionCheckpointAt: 0
};
