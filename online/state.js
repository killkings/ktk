/* Estado único da sessão multiplayer. Todos os módulos importam esta mesma instância. */
function createSessionId() {
  return window.crypto?.randomUUID?.() || (String(Date.now()) + "-" + Math.random().toString(36).slice(2));
}

export const state = {
  user: null, accessToken: "", channel: null, joined: false, online: false,
  leaving: false,
  displayName: "", lastSent: 0, lastCheckpoint: 0, lastTrack: 0, lastDbHeartbeat: 0,
  lastPosition: null, lastIntentSignature: "", lastInputSignature: "",
  stepInFlight: false, stepController: null, stepSequence: 0, activeStepId: 0,
  sessionId: createSessionId(),
  gameSocket: null, gameSocketConnected: false, gameTransportManualClose: false,
  gameTransportEverConnected: false, movementSequence: 0, lastSentMovementSequence: 0,
  lastMovementInput: null, lastMovementSentAt: 0, lastReconciledServerTick: 0,
  remote: new Map(), profileCache: new Map(), profileLoads: new Map(),
  profileRetryTimers: new Map(), profileRetryCounts: new Map(), seenCombatEvents: new Set(),
  lastLocalKnockbackAt: "", intentInFlight: false, worldStateRequestId: 0, connecting: false
};
