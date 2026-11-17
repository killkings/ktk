import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { AuthoritativeWorld, SIMULATION_HZ, SNAPSHOT_HZ } from "./world.mjs";
import { SupabaseStore } from "./supabase-store.mjs";

const PORT = Number(process.env.PORT || 8080);
const AUTH_TIMEOUT_MS = 45000;
const MAX_MESSAGES_PER_SECOND = 40;
const MAX_CONNECTED_PLAYERS = 128;
const PERSIST_INTERVAL_MS = 1000;
const REFRESH_INTERVAL_MS = 1000;
const ORIGINS = new Set(
  String(process.env.ALLOWED_ORIGINS || "https://killkings.github.io,http://localhost:8080,http://127.0.0.1:8080")
    .split(",").map(value => value.trim()).filter(Boolean)
);

const store = new SupabaseStore();
const world = new AuthoritativeWorld();
const serverEpoch = randomUUID();
const clients = new Map();
let shuttingDown = false;
let lastPersistAt = 0;
let lastRefreshAt = 0;
let snapshotAccumulator = 0;

function sendHttpJson(response, status, payload, origin = "") {
  const headers = {
    "content-type": "application/json",
    "cache-control": "no-store"
  };
  if (origin && ORIGINS.has(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers["vary"] = "Origin";
  }
  response.writeHead(status, headers);
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request, maximumBytes = 16384) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBytes) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  const value = JSON.parse(text || "{}");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_BODY");
  return value;
}

async function handleHttpRequest(request, response) {
  const origin = String(request.headers.origin || "");
  if (request.method === "OPTIONS") {
    if (!ORIGINS.has(origin)) {
      sendHttpJson(response, 403, { error: "ORIGIN_FORBIDDEN" });
      return;
    }
    response.writeHead(204, {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "600",
      "vary": "Origin"
    });
    response.end();
    return;
  }

  if (request.url === "/healthz" && request.method === "GET") {
    sendHttpJson(response, 200, {
      ok: !shuttingDown,
      world: "main",
      tick: world.tickNumber,
      connectedPlayers: world.getConnectedPlayers().length
    });
    return;
  }

  if (request.url === "/leave" && request.method === "POST") {
    if (!ORIGINS.has(origin)) {
      sendHttpJson(response, 403, { error: "ORIGIN_FORBIDDEN" });
      return;
    }
    try {
      const body = await readJsonBody(request);
      const user = await store.authenticateUser(body.access_token);
      const userId = String(user.id);
      const player = world.players.get(userId);
      if (player?.isAlive) await persistWorldPositions([player]);
      await store.leaveWorld(body.access_token);

      const ws = clients.get(userId);
      clients.delete(userId);
      if (player) {
        player.isAlive = false;
        world.disconnectPlayer(userId);
      }
      if (ws) {
        send(ws, { type: "server_death", reason: "PLAYER_LEFT_WORLD" });
        try { ws.close(4003, "PLAYER_LEFT_WORLD"); } catch { ws.terminate(); }
      }
      sendHttpJson(response, 200, { ok: true, dead: true }, origin);
    } catch (error) {
      console.warn("KTK page exit:", error.message);
      sendHttpJson(response, 400, { ok: false, error: error.message || "LEAVE_FAILED" }, origin);
    }
    return;
  }

  sendHttpJson(response, 404, { error: "NOT_FOUND" }, origin);
}

const httpServer = createServer((request, response) => {
  void handleHttpRequest(request, response).catch(error => {
    console.error("KTK HTTP handler:", error.message);
    if (!response.headersSent) sendHttpJson(response, 500, { error: "INTERNAL_ERROR" });
    else response.destroy();
  });
});

const websocketServer = new WebSocketServer({
  noServer: true,
  maxPayload: 16 * 1024,
  maxPendingAutoPongs: 8,
  perMessageDeflate: false
});

httpServer.on("upgrade", (request, socket, head) => {
  let pathname = "/";
  try { pathname = new URL(request.url, "http://localhost").pathname; }
  catch { socket.destroy(); return; }
  const origin = String(request.headers.origin || "");
  if (pathname !== "/game" || (origin && !ORIGINS.has(origin))) {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  websocketServer.handleUpgrade(request, socket, head, ws => {
    websocketServer.emit("connection", ws, request);
  });
});

function send(ws, payload) {
  if (ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

function closeWithError(ws, code, message) {
  send(ws, { type: "error", code, message });
  try { ws.close(1008, String(code).slice(0, 100)); }
  catch { ws.terminate(); }
}

function profileFor(data, id) {
  return data.profiles.get(String(id)) || {};
}

async function doRefreshWorldFromDatabase() {
  const data = await store.loadWorldData();
  world.setEntities(data.entities);
  const activeIds = new Set();
  for (const row of data.players) {
    const id = String(row.user_id);
    activeIds.add(id);
    world.upsertFromDatabase(row, profileFor(data, id));
  }

  for (const [id, ws] of clients) {
    if (activeIds.has(id)) continue;
    send(ws, { type: "server_death", reason: "PLAYER_NOT_ACTIVE" });
    clients.delete(id);
    world.players.delete(id);
    try { ws.close(4003, "PLAYER_NOT_ACTIVE"); } catch { ws.terminate(); }
  }
  return data;
}

let refreshPromise = null;
function refreshWorldFromDatabase() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = doRefreshWorldFromDatabase().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

let persistenceQueue = Promise.resolve();
function persistWorldPositions(players = world.getConnectedPlayers()) {
  const userIds = [...new Set((Array.isArray(players) ? players : [])
    .map(player => String(player?.id || "")).filter(Boolean))];
  const task = persistenceQueue.then(async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      // Snapshot the latest state only when this write reaches the queue.
      const snapshot = userIds
        .map(id => world.players.get(id))
        .filter(player => player?.isAlive)
        .map(player => ({
          id: player.id,
          expectedPositionUpdatedAt: player.lastPersistedPositionAt,
          x: player.x,
          y: player.y,
          direction: player.direction,
          inputX: player.inputX,
          inputY: player.inputY,
          moving: player.moving,
          running: player.running,
          guarding: player.guarding
        }));
      if (!snapshot.length) return [];

      const rows = await store.persistPositions(snapshot);
      world.markPersisted(rows);
      const written = new Set((Array.isArray(rows) ? rows : []).map(row => String(row.user_id)));
      const conflicts = snapshot.filter(player => !written.has(String(player.id)));
      if (!conflicts.length) {
        lastPersistAt = Date.now();
        return rows;
      }

      // A database action (knockback/death/etc.) changed one or more rows
      // between the read and write. Reload authoritative rows, then retry
      // once using their new versions instead of overwriting them.
      await refreshWorldFromDatabase();
      if (attempt === 1) {
        throw new Error("POSITION_VERSION_CONFLICT: uma posição foi alterada por outra ação do servidor.");
      }
    }
    return [];
  });
  persistenceQueue = task.catch(() => {});
  return task;
}

async function reauthenticateSocket(ws, packet) {
  try {
    const user = await store.authenticateUser(packet.access_token);
    if (String(user.id) !== String(ws.userId)) {
      closeWithError(ws, "IDENTITY_CHANGED", "A identidade da sessão mudou.");
      return;
    }
    ws.authenticatedAt = Date.now();
    send(ws, { type: "reauthenticated" });
  } catch (error) {
    console.warn("KTK WebSocket reauthentication:", error.message);
    closeWithError(ws, "REAUTH_FAILED", "Não foi possível renovar a autenticação.");
  }
}

function handleSnapshot(ws, packet) {
  const userId = ws.userId;
  if (!userId) return;
  if (packet.type === "input") {
    const accepted = world.receiveInput(userId, packet);
    if (!accepted) {
      send(ws, { type: "input_rejected", sequence: packet.sequence });
    }
    return;
  }
  if (packet.type === "ping") {
    send(ws, {
      type: "pong",
      sentAt: finiteTimestamp(packet.sentAt),
      serverTime: Date.now(),
      tick: world.tickNumber
    });
    return;
  }
  if (packet.type === "flush") {
    const requestId = String(packet.requestId || "").slice(0, 80);
    const player = world.players.get(userId);
    if (!player?.isAlive) {
      send(ws, { type: "flush_error", requestId, message: "O personagem não está ativo no mundo." });
      return;
    }
    void persistWorldPositions()
      .then(() => send(ws, { type: "flush_ack", requestId, tick: world.tickNumber }))
      .catch(error => {
        console.error("KTK position flush:", error.message);
        send(ws, { type: "flush_error", requestId, message: "Não foi possível gravar a posição no servidor." });
      });
    return;
  }
  if (packet.type === "heartbeat") {
    ws.lastHeartbeatAt = Date.now();
    return;
  }
  send(ws, { type: "error", code: "UNKNOWN_MESSAGE", message: "Mensagem multiplayer desconhecida." });
}

function finiteTimestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

async function authenticateSocket(ws, packet) {
  if (ws.authenticated || ws.authenticating) return;
  if (packet.type !== "authenticate") {
    closeWithError(ws, "AUTH_REQUIRED", "Autentique a conexão do jogo.");
    return;
  }

  ws.authenticating = true;
  try {
    const user = await store.authenticateUser(packet.access_token);
    const existing = clients.get(String(user.id));
    if (!existing && clients.size >= MAX_CONNECTED_PLAYERS) {
      closeWithError(ws, "WORLD_FULL", "O mundo atingiu o limite de jogadores conectados.");
      return;
    }
    if (existing && existing !== ws) {
      send(existing, { type: "session_replaced" });
      try { existing.close(4001, "SESSION_REPLACED"); } catch { existing.terminate(); }
    }

    const catalog = await store.loadCatalog(packet.access_token);
    world.setCatalog(catalog);
    await refreshWorldFromDatabase();

    const player = world.connectPlayer(user.id);
    if (!player) {
      closeWithError(ws, "PLAYER_NOT_ACTIVE", "O personagem não está ativo no mundo.");
      return;
    }

    ws.authenticated = true;
    ws.userId = String(user.id);
    ws.authenticatedAt = Date.now();
    ws.lastHeartbeatAt = Date.now();
    ws.messageWindowAt = Date.now();
    ws.messageCount = 0;
    clients.set(ws.userId, ws);

    send(ws, {
      ...world.welcome(ws.userId),
      serverEpoch
    });
  } catch (error) {
    ws.authenticating = false;
    console.error("KTK WebSocket authentication:", error.message);
    closeWithError(ws, "AUTH_FAILED", "Não foi possível autenticar o jogador no servidor do mundo.");
  }
}

websocketServer.on("connection", ws => {
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  ws.authenticated = false;
  ws.authenticating = false;
  ws.messageWindowAt = Date.now();
  ws.messageCount = 0;
  ws.userId = null;
  const authTimer = setTimeout(() => {
    if (!ws.authenticated) closeWithError(ws, "AUTH_TIMEOUT", "Tempo esgotado ao autenticar.");
  }, AUTH_TIMEOUT_MS);

  ws.on("message", raw => {
    const now = Date.now();
    if (now - ws.messageWindowAt >= 1000) {
      ws.messageWindowAt = now;
      ws.messageCount = 0;
    }
    ws.messageCount += 1;
    if (ws.messageCount > MAX_MESSAGES_PER_SECOND) {
      closeWithError(ws, "RATE_LIMIT", "Muitas mensagens em sequência.");
      return;
    }

    let packet;
    try {
      packet = JSON.parse(raw.toString());
    } catch {
      closeWithError(ws, "INVALID_JSON", "Mensagem inválida.");
      return;
    }
    if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
      closeWithError(ws, "INVALID_MESSAGE", "Mensagem inválida.");
      return;
    }
    if (!ws.authenticated) {
      void authenticateSocket(ws, packet).then(() => {
        if (ws.authenticated) clearTimeout(authTimer);
      });
      return;
    }
    if (packet.type === "reauthenticate") {
      void reauthenticateSocket(ws, packet);
      return;
    }
    handleSnapshot(ws, packet);
  });

  ws.on("close", () => {
    clearTimeout(authTimer);
    if (!ws.userId || clients.get(ws.userId) !== ws) return;
    clients.delete(ws.userId);
    const player = world.disconnectPlayer(ws.userId);
    if (player) {
      void persistWorldPositions([player]).catch(error => {
        console.error("KTK disconnect flush:", error.message);
      });
    }
  });

  ws.on("error", error => {
    console.warn("KTK WebSocket:", error.message);
  });
});

function broadcastSnapshot() {
  const snapshot = world.snapshot();
  const data = JSON.stringify(snapshot);
  for (const ws of clients.values()) {
    if (ws.readyState === WebSocket.OPEN) {
      if (ws.bufferedAmount > 256 * 1024) {
        ws.terminate();
        continue;
      }
      try { ws.send(data); } catch { /* close handler will clean it up */ }
    }
  }
}

let lastTickTime = performance.now();
let accumulator = 0;
const fixedDelta = 1 / SIMULATION_HZ;
const tickTimer = setInterval(() => {
  const now = performance.now();
  const elapsed = Math.min(0.1, Math.max(0, (now - lastTickTime) / 1000));
  lastTickTime = now;
  accumulator = Math.min(accumulator + elapsed, fixedDelta * 4);

  let steps = 0;
  while (accumulator >= fixedDelta && steps < 4) {
    world.tick(fixedDelta, now);
    accumulator -= fixedDelta;
    steps += 1;
    snapshotAccumulator += fixedDelta;
    if (snapshotAccumulator >= 1 / SNAPSHOT_HZ) {
      snapshotAccumulator -= 1 / SNAPSHOT_HZ;
      broadcastSnapshot();
    }
  }
}, 5);

let persistenceInFlight = false;
const persistenceTimer = setInterval(async () => {
  if (shuttingDown || persistenceInFlight || !world.getConnectedPlayers().length) return;
  persistenceInFlight = true;
  try {
    await persistWorldPositions(world.getConnectedPlayers());
    if (Date.now() - lastRefreshAt >= REFRESH_INTERVAL_MS) {
      await refreshWorldFromDatabase();
      lastRefreshAt = Date.now();
    }
  } catch (error) {
    console.error("KTK world persistence:", error.message);
  } finally {
    persistenceInFlight = false;
  }
}, PERSIST_INTERVAL_MS);

const socketHeartbeatTimer = setInterval(() => {
  for (const ws of clients.values()) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try { ws.ping(); }
    catch { ws.terminate(); }
  }
}, 15000);

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(tickTimer);
  clearInterval(persistenceTimer);
  clearInterval(socketHeartbeatTimer);
  console.log("KTK world server shutting down:", signal);
  void persistWorldPositions()
    .catch(error => console.error("KTK shutdown persistence:", error.message))
    .finally(() => {
      for (const ws of clients.values()) {
        try { ws.close(1001, "SERVER_SHUTDOWN"); } catch { ws.terminate(); }
      }
      httpServer.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 5000).unref();
    });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log("KTK authoritative world listening on port", PORT);
});
