/* Transporte persistente do mundo autoritativo. */
import { state } from "./state.js?v=20261117-websocket-world-001";

const GAME_SERVER_URL = window.KTK_GAME_SERVER_URL ||
  "wss://ktk-authoritative-world-uriel29m.fly.dev/game";
const CONNECT_TIMEOUT_MS = 45000;
const FLUSH_TIMEOUT_MS = 3000;
let connectPromise = null;
let reconnectTimer = null;
let reconnectDelay = 500;
let flushCounter = 0;
let serverEpoch = "";
let pingTimer = null;
const flushWaiters = new Map();

function rejectFlushWaiters(error) {
  for (const waiter of flushWaiters.values()) {
    clearTimeout(waiter.timer);
    waiter.reject(error);
  }
  flushWaiters.clear();
}

function applySnapshot(packet) {
  const players = Array.isArray(packet.players) ? packet.players : [];
  const tick = Number(packet.tick) || 0;
  const self = players.find(player => String(player.user_id) === String(state.user?.id));
  if (self) {
    const acknowledged = Math.max(0, Number(self.lastInputSequence) || 0);
    state.movementSequence = Math.max(Number(state.movementSequence) || 0, acknowledged);
    state.lastSentMovementSequence = Math.max(Number(state.lastSentMovementSequence) || 0, acknowledged);
  }
  if (self && tick > state.lastReconciledServerTick) {
    state.lastReconciledServerTick = tick;
    window.KTKWorldEntities?.reconcileLocalPosition?.(
      Number(self.x), Number(self.y), Number(self.direction),
      Number(state.lastMovementLatencyMs) || 150,
      state.lastMovementInput || window.KTKWorldEntities?.getLocalControls?.()
    );
  }
  window.KTKRemoteSync?.acceptGameServerPlayers?.(players, tick, serverEpoch);
}

function startPingLoop(ws) {
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = setInterval(() => {
    if (ws !== state.gameSocket || ws.readyState !== WebSocket.OPEN) return;
    const token = String(state.accessToken || "");
    if (token && token !== ws.authToken) {
      try {
        ws.send(JSON.stringify({ type: "reauthenticate", access_token: token }));
        ws.authToken = token;
      } catch {}
    }
    const sentAt = performance.now();
    try { ws.send(JSON.stringify({ type: "ping", sentAt })); } catch {}
  }, 5000);
}

function scheduleReconnect() {
  if (reconnectTimer || state.gameTransportManualClose ||
      !state.gameTransportEverConnected || !state.joined || state.leaving) return;
  const delay = reconnectDelay;
  reconnectDelay = Math.min(6000, Math.round(reconnectDelay * 1.7));
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connectGameServer(state.accessToken, { reconnect: true }).catch(error => {
      console.warn("KTK world reconnect:", error?.message || error);
    });
  }, delay);
}

export function connectGameServer(accessToken = state.accessToken, { reconnect = false } = {}) {
  if (state.gameSocketConnected && state.gameSocket?.readyState === WebSocket.OPEN) return Promise.resolve(true);
  if (connectPromise) return connectPromise;
  if (typeof WebSocket !== "function") return Promise.reject(new Error("Este navegador não oferece suporte a WebSocket."));
  if (!accessToken) return Promise.reject(new Error("A sessão não possui um token de autenticação."));

  state.gameTransportManualClose = false;
  connectPromise = new Promise((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(GAME_SERVER_URL);
    ws.authToken = accessToken;
    state.gameSocket = ws;

    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      if (error) reject(error);
      else resolve(true);
    };

    const connectTimer = setTimeout(() => {
      try { ws.close(4000, "CONNECT_TIMEOUT"); } catch {}
      finish(new Error("O servidor do mundo não respondeu dentro do prazo."));
    }, CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      try { ws.send(JSON.stringify({ type: "authenticate", access_token: accessToken })); }
      catch (error) { finish(error); }
    };

    ws.onmessage = event => {
      let packet;
      try { packet = JSON.parse(String(event.data)); }
      catch { console.warn("KTK world: pacote WebSocket inválido."); return; }

      if (packet.type === "welcome") {
        serverEpoch = String(packet.serverEpoch || "game-server");
        state.gameSocketConnected = true;
        state.gameTransportEverConnected = true;
        state.gameTransportManualClose = false;
        state.lastReconciledServerTick = 0;
        reconnectDelay = 500;
        startPingLoop(ws);
        applySnapshot(packet);
        state.lastInputSignature = "";
        finish();
        if (state.joined) queueMicrotask(() => {
          void window.KTKOnline?.sendPosition?.(true);
        });
        return;
      }
      if (packet.type === "snapshot") {
        if (state.gameSocketConnected) applySnapshot(packet);
        return;
      }
      if (packet.type === "pong") {
        const sentAt = Number(packet.sentAt);
        if (Number.isFinite(sentAt)) {
          const rtt = Math.max(0, Math.min(2000, performance.now() - sentAt));
          state.lastMovementLatencyMs = Math.max(
            0, Math.min(750, (Number(state.lastMovementLatencyMs) || rtt) * 0.75 + rtt * 0.25)
          );
        }
        return;
      }
      if (packet.type === "flush_ack" || packet.type === "flush_error") {
        const id = String(packet.requestId || "");
        const waiter = flushWaiters.get(id);
        if (waiter) {
          clearTimeout(waiter.timer);
          flushWaiters.delete(id);
          if (packet.type === "flush_ack") waiter.resolve(packet);
          else waiter.reject(new Error(packet.message || "Falha ao gravar posição no servidor."));
        }
        return;
      }
      if (packet.type === "server_death") {
        state.gameTransportManualClose = true;
        window.KTKWorldEntities?.serverDeath?.();
        try { ws.close(4003, "PLAYER_NOT_ACTIVE"); } catch {}
        return;
      }
      if (packet.type === "session_replaced") {
        state.gameTransportManualClose = true;
        try { ws.close(4001, "SESSION_REPLACED"); } catch {}
        return;
      }
      if (packet.type === "error") {
        const error = new Error(packet.message || "Falha no servidor multiplayer.");
        if (!settled) finish(error);
        else console.warn("KTK world server:", packet.code, error.message);
      }
    };

    ws.onerror = () => finish(new Error("Não foi possível abrir a conexão WebSocket com o servidor do mundo."));
    ws.onclose = () => {
      clearTimeout(connectTimer);
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = null;
      if (state.gameSocket === ws) {
        state.gameSocket = null;
        state.gameSocketConnected = false;
      }
      rejectFlushWaiters(new Error("A conexão com o servidor do mundo foi interrompida."));
      if (!settled) finish(new Error("O servidor do mundo encerrou a conexão antes de autenticar."));
      if (!state.gameTransportManualClose && state.joined && state.gameTransportEverConnected) scheduleReconnect();
    };
  }).finally(() => { connectPromise = null; });

  return connectPromise;
}

export function sendMovementInput(input) {
  const ws = state.gameSocket;
  if (!state.gameSocketConnected || !ws || ws.readyState !== WebSocket.OPEN) return 0;
  const sequence = (Number(state.movementSequence) || 0) + 1;
  state.movementSequence = sequence;
  try {
    ws.send(JSON.stringify({
      type: "input", sequence,
      inputX: input.inputX, inputY: input.inputY,
      running: Boolean(input.running), guarding: Boolean(input.guarding)
    }));
    return sequence;
  } catch (error) {
    console.warn("KTK movement send:", error?.message || error);
    return 0;
  }
}

export function flushGameServerPositions() {
  const ws = state.gameSocket;
  if (!state.gameSocketConnected || !ws || ws.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error("O servidor do mundo está desconectado; a posição ainda não foi confirmada."));
  }
  const requestId = String(Date.now()) + "-" + (++flushCounter);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      flushWaiters.delete(requestId);
      reject(new Error("O servidor não confirmou a gravação da posição."));
    }, FLUSH_TIMEOUT_MS);
    flushWaiters.set(requestId, { resolve, reject, timer });
    try { ws.send(JSON.stringify({ type: "flush", requestId })); }
    catch (error) {
      clearTimeout(timer);
      flushWaiters.delete(requestId);
      reject(error);
    }
  });
}

export async function disconnectGameServer() {
  state.gameTransportManualClose = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = null;
  const ws = state.gameSocket;
  state.gameSocket = null;
  state.gameSocketConnected = false;
  rejectFlushWaiters(new Error("A sessão multiplayer foi encerrada."));
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    try { ws.close(1000, "CLIENT_LEAVE"); } catch {}
  }
}
