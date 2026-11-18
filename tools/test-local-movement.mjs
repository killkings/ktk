import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [
  gameState, replica, movementSource, input, session, playerSync,
  realtime, online, html, rootHtml, migration, mapSource
] = await Promise.all([
  read("../js/game-state.js"),
  read("../multiplayer/player-replica.js"),
  read("../online/movement.js"),
  read("../input/input-controller.js"),
  read("../online/session.js"),
  read("../online/player-sync.js"),
  read("../online/realtime.js"),
  read("../js/online.js"),
  read("../campo_livre_atualizado.html"),
  read("../index.html"),
  read("../supabase/migrations/20261118000803_simplify_player_walking.sql"),
  read("../mapa/mapa.js")
]);

// The browser owns exactly one local position. Each frame advances that position;
// no server reply or reconciliation is part of this loop.
const movementStart = gameState.indexOf(
  "var  player = {x:0,y:0,direction:2,knockback:null,knockbackHeight:0};"
);
const movementEnd = gameState.indexOf("var  TILE = 72;", movementStart);
assert.ok(movementStart >= 0 && movementEnd > movementStart);

function makeLocalContext({ collisionCircles = [], serverEntities = [], skeleton = null, worldMap = null } = {}) {
  const enemy = skeleton || { x: 10000, y: 10000, defeated: false, collision_radius: 18 };
  const context = {
    playerDead: false,
    playerMoving: true,
    playerRunning: false,
    playerInputX: 1,
    playerInputY: 0,
    rightMouseHeld: false,
    shieldStaminaExhausted: false,
    getBlockingShield: () => null,
    wearableSlotOrder: ["head", "chest"],
    equippedWearables: { head: null, chest: null },
    remotePlayers: new Map(),
    window: {
      KTKEnemySkeleton: { entity: enemy },
      KTKWorldMap: worldMap || { getCollisionCircles: () => collisionCircles }
    },
    serverWorldEntities: new Map(serverEntities.map((entity, index) => [String(index), entity])),
    SPEED: 225,
    COLLISION_RADIUS: 18
  };
  vm.createContext(context);
  vm.runInContext(gameState.slice(movementStart, movementEnd), context);
  context.setLocalPlayerPosition(100, 120, 2);
  return context;
}

const local = makeLocalContext();
local.updateLocalPlayerVisual(1 / 60);
assert.ok(Math.abs(local.player.x - 103.75) < 0.001,
  "A velocidade normal deve ser 225 px/s.");
assert.equal(local.playerVisual.x, local.player.x,
  "A posição de jogo e a posição desenhada devem ser a mesma.");
assert.equal(local.player.direction, 3, "O personagem deve olhar para a direita.");

const beforeDiagonal = { x: local.player.x, y: local.player.y };
local.playerInputX = 1;
local.playerInputY = -1;
local.updateLocalPlayerVisual(1 / 60);
assert.ok(Math.abs(Math.hypot(
  local.player.x - beforeDiagonal.x,
  local.player.y - beforeDiagonal.y
) - 3.75) < 0.001, "A diagonal deve ser normalizada e não pode acelerar.");
assert.equal(local.player.direction, 0, "A direção diagonal deve privilegiar o eixo dominante.");

const running = makeLocalContext();
running.playerRunning = true;
running.updateLocalPlayerVisual(1 / 60);
assert.ok(Math.abs(running.player.x - 105.625) < 0.001,
  "A corrida deve avançar a 337,5 px/s.");

const guarding = makeLocalContext();
guarding.rightMouseHeld = true;
guarding.getBlockingShield = () => ({ id: "shield" });
guarding.updateLocalPlayerVisual(1 / 60);
assert.ok(Math.abs(guarding.player.x - 101.875) < 0.001,
  "Bloquear deve reduzir a velocidade para 112,5 px/s.");

const gearPenalty = makeLocalContext();
gearPenalty.equippedWearables.chest = { durability: 20, speedPenalty: 1 };
gearPenalty.updateLocalPlayerVisual(1 / 60);
assert.ok(Math.abs(gearPenalty.player.x - 101.875) < 0.001,
  "A penalidade de equipamento deve ser aplicada sem correções de rede.");

const blocked = makeLocalContext();
blocked.remotePlayers.set("other", { x: 130, y: 120, targetX: 130, targetY: 120 });
blocked.updateLocalPlayerVisual(1 / 60);
assert.equal(blocked.player.x, 100,
  "A colisão com outro jogador deve impedir aproximação através do raio de colisão.");

const blockedBySkeleton = makeLocalContext({
  skeleton: { x: 130, y: 120, defeated: false, radius: 18 }
});
blockedBySkeleton.setLocalPlayerPosition(80, 120, 3);
for (let frame = 0; frame < 20; frame++) blockedBySkeleton.updateLocalPlayerVisual(1 / 60);
assert.ok(blockedBySkeleton.player.x > 90 && blockedBySkeleton.player.x <= 94,
  "O personagem deve se aproximar do esqueleto e parar antes de atravessá-lo.");

const blockedByResource = makeLocalContext({
  serverEntities: [{ type: "resource", status: "ready", x: 130, y: 120, radius: 8 }]
});
blockedByResource.setLocalPlayerPosition(80, 120, 3);
for (let frame = 0; frame < 20; frame++) blockedByResource.updateLocalPlayerVisual(1 / 60);
assert.ok(blockedByResource.player.x > 100 && blockedByResource.player.x <= 104,
  "Nós de recursos ativos devem bloquear a passagem após uma aproximação real.");

const passDepletedResource = makeLocalContext({
  serverEntities: [{ type: "resource", status: "depleted", x: 130, y: 120, radius: 8 }]
});
passDepletedResource.updateLocalPlayerVisual(1 / 60);
assert.ok(passDepletedResource.player.x > 100,
  "Um nó de recurso esgotado não pode continuar bloqueando o caminho.");

const mapContext = {
  window: {},
  Image: class {
    set src(value) { this._src = value; }
  }
};
vm.createContext(mapContext);
vm.runInContext(mapSource, mapContext);
const worldMap = mapContext.window.KTKWorldMap;
assert.equal(typeof worldMap.getCollisionCircles, "function",
  "O mapa deve expor os troncos das árvores como colisores.");
const nearbyTrees = worldMap.getCollisionCircles(0, 0, 640);
assert.ok(nearbyTrees.length > 0,
  "O gerador procedural deve produzir árvores com colisão.");
assert.equal(
  JSON.stringify(nearbyTrees),
  JSON.stringify(worldMap.getCollisionCircles(0, 0, 640)),
  "As colisões ambientais devem ser determinísticas entre quadros."
);
const tree = nearbyTrees[0];
const blockedByTree = makeLocalContext({ worldMap });
blockedByTree.setLocalPlayerPosition(tree.x - 30, tree.y, 2);
for (let frame = 0; frame < 40; frame++) blockedByTree.updateLocalPlayerVisual(1 / 60);
assert.ok(tree.x - blockedByTree.player.x >= 25 - 0.01,
  "O personagem deve parar no tronco, sem atravessar a árvore.");

const monotonic = makeLocalContext();
let previousX = monotonic.player.x;
for (let frame = 0; frame < 30; frame++) {
  monotonic.updateLocalPlayerVisual(1 / 60);
  assert.ok(monotonic.player.x >= previousX,
    "Uma caminhada em linha reta não pode receber passos para trás.");
  previousX = monotonic.player.x;
}
assert.ok(monotonic.player.x > 200, "O movimento deve continuar sem depender da rede.");

// Remote players use one target and a simple speed-limited interpolation.
const remoteStart = replica.indexOf("  function updateRemotePlayerMotion(dt) {");
const remoteEnd = replica.indexOf("  function normalizeRemoteWearables", remoteStart);
assert.ok(remoteStart >= 0 && remoteEnd > remoteStart);
const remote = {
  x: 0, y: 0, targetX: 100, targetY: 0,
  direction: 3, serverMoving: true,
  lastPositionReceivedAt: 5000, walkTime: 0
};
let remoteClock = 5000;
const remoteContext = {
  remotePlayers: new Map([["remote", remote]]),
  window: { KTKEnemySkeleton: { entity: null } },
  performance: { now: () => remoteClock },
  KNOCKBACK_SECONDS: 0.24,
  KNOCKBACK_HEIGHT: 12,
  PUNCH_ANIMATION_SECONDS: 0.42,
  BOOMERANG_PROJECTILE_RADIUS: 12
};
vm.createContext(remoteContext);
vm.runInContext(
  replica.slice(remoteStart, remoteEnd) +
  ";globalThis.stepRemoteMotion=updateRemotePlayerMotion;",
  remoteContext
);
let lastRemoteX = remote.x;
for (let frame = 0; frame < 12; frame++) {
  remoteContext.stepRemoteMotion(1 / 60);
  assert.ok(remote.x >= lastRemoteX,
    "Uma amostra remota mais nova não pode inverter a caminhada.");
  assert.ok(remote.x - lastRemoteX <= 520 / 60 + 0.001,
    "A interpolação remota deve ter velocidade máxima limitada.");
  lastRemoteX = remote.x;
}
assert.ok(remote.x > 90, "O personagem remoto deve alcançar suavemente sua posição-alvo.");
assert.equal(remote.moving, true);

// Network module: only small position broadcasts and periodic checkpoints remain.
const executableMovement = movementSource
  .replace(/^import .*;\s*$/gm, "")
  .replace(/^export function /gm, "function ")
  .replace(/^export async function /gm, "async function ");
const sent = [];
const rpcCalls = [];
let networkClock = 10000;
const networkState = {
  online: true,
  joined: true,
  leaving: false,
  user: { id: "player-1" },
  sessionId: "session-1",
  displayName: "Teste",
  lastPositionCheckpointAt: 0,
  channel: {
    send(message) {
      sent.push(message);
      return Promise.resolve("ok");
    }
  }
};
const networkWindow = {
  player: { x: 12, y: 34, direction: 3 },
  playerInputX: 1,
  playerInputY: 0,
  playerMoving: true,
  playerRunning: false,
  rightMouseHeld: false,
  shieldStaminaExhausted: false,
  inventory: []
};
const networkContext = {
  state: networkState,
  window: networkWindow,
  performance: { now: () => networkClock },
  supabase: {
    rpc(name, args) {
      rpcCalls.push({ name, args });
      return Promise.resolve({ error: null });
    }
  },
  console
};
vm.createContext(networkContext);
vm.runInContext(executableMovement + ";globalThis.sendPosition=sendPosition;", networkContext);
networkContext.sendPosition(true);
assert.equal(sent.length, 1);
assert.equal(sent[0].event, "player_position");
assert.equal(sent[0].payload.x, 12);
assert.equal(sent[0].payload.y, 34);
assert.equal(sent[0].payload.direction, 3);
assert.equal(rpcCalls[0].name, "ktk_checkpoint_position");
assert.equal(rpcCalls[0].args.p_x, 12);
assert.equal(rpcCalls[0].args.p_y, 34);
assert.doesNotMatch(movementSource, /ktk_step_player|lastMovementLatencyMs|reconcileLocalPosition/);
assert.match(movementSource, /event:\s*"player_position"/);
assert.match(movementSource, /ktk_checkpoint_position/);

const stopped = makeLocalContext();
stopped.playerMoving = false;
stopped.playerInputX = 0;
stopped.playerInputY = 0;
stopped.updateLocalPlayerVisual(1 / 60);

// No keyboard, mouse, lifecycle or network module is allowed to call the old step RPC.
assert.doesNotMatch(input, /sendImmediateMovementIntent|ktk_step_player|sendPosition/);
assert.doesNotMatch(session, /ktk_step_player|stepInFlight|stepController|stepSequence|lastMovementLatencyMs/);
assert.doesNotMatch(playerSync, /applyOwnServerPosition|reconcileLocalPosition|intentTimeline/);
assert.match(playerSync, /acceptMovementBroadcast/);
assert.match(realtime, /event:\s*"player_position"/);
assert.doesNotMatch(replica, /getLocalIntentTimeline|getLocalControls|motionSnapshots|REMOTE_MOTION_SNAPSHOT|reconcileLocalPosition/);
assert.match(html, /online\.js\?v=20261118-remote-hit-v1/);
assert.match(html, /mapa\.js\?v=20261117-collision-v1/);
assert.match(html, /game-state\.js\?v=20261117-collision-v1/);
assert.match(rootHtml, /20261118-inventory-interaction-v1/);
assert.match(mapSource, /getCollisionCircles/);
assert.match(migration, /ktk_checkpoint_position/);
assert.match(migration, /drop function if exists public\.ktk_step_player/);
assert.match(migration, /drop function if exists ktk_private\.step_player_unlocked_v2/);

console.log("Local and remote walking, speed, collisions, monotonic movement, Broadcast and Supabase checkpoints passed.");
