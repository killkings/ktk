import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [input, replica, gameState, renderer, movement, online, html, migration, resetPatch, playerSync, rootHtml, session, realtime, actions, supabaseClient] = await Promise.all([
  read("../input/input-controller.js"),
  read("../multiplayer/player-replica.js"),
  read("../js/game-state.js"),
  read("../render/world-renderer.js"),
  read("../online/movement.js"),
  read("../js/online.js"),
  read("../campo_livre_atualizado.html"),
  read("../supabase/migrations/20261117204627_authoritative_movement_latency_and_intent_timeline.sql"),
  read("../supabase/migrations/20261117204956_ignore_stale_movement_intent_after_lifecycle_reset.sql"),
  read("../online/player-sync.js"),
  read("../index.html"),
  read("../online/session.js"),
  read("../online/realtime.js"),
  read("../online/actions.js"),
  read("../online/supabase-client.js")
]);

// Keyboard state includes the age of the exact active intent, not the last
// heartbeat time. A direction change resets that age immediately.
const keys = new Set(["w"]);
const stamina = { value: 60 };
let clock = 1000;
const replicaContext = {
  window: {}, keys, performance: { now: () => clock },
  playerStats: { stats: { stamina } },
  rightMouseHeld: false, shieldStaminaExhausted: false,
  getBlockingShield: () => ({ id: "shield" }),
  getWorldEntities: () => [],
  applyServerState() {}, applyWorldEntity() {}, applyWorldState() {},
  setAuthoritativePlayerPosition() {}
};
vm.createContext(replicaContext);
vm.runInContext(replica, replicaContext, { filename: "multiplayer/player-replica.js" });
let controls = replicaContext.window.KTKWorldEntities.getLocalControls();
assert.equal(controls.inputX, 0);
assert.equal(controls.inputY, -1);
assert.equal(controls.inputAgeMs, 0);
const firstIntentRevision=controls.intentRevision;
assert.ok(firstIntentRevision>0);
clock = 1125;
keys.delete("w");
keys.add("d");
controls = replicaContext.window.KTKWorldEntities.getLocalControls();
assert.equal(controls.inputX, 1);
assert.equal(controls.inputY, 0);
assert.equal(controls.inputAgeMs, 0);
const turnedIntentRevision=controls.intentRevision;
assert.notEqual(turnedIntentRevision,firstIntentRevision);
clock = 1250;
const heldControls=replicaContext.window.KTKWorldEntities.getLocalControls();
assert.equal(heldControls.inputAgeMs, 125);
assert.equal(heldControls.intentRevision,turnedIntentRevision,
  "Manter o mesmo vetor não pode criar uma nova geração a cada leitura.");
keys.add("shift");
assert.equal(replicaContext.window.KTKWorldEntities.getLocalControls().running, true);
stamina.value = 0;
assert.equal(replicaContext.window.KTKWorldEntities.getLocalControls().running, false);
stamina.value = 60;
replicaContext.rightMouseHeld = true;
assert.equal(replicaContext.window.KTKWorldEntities.getLocalControls().guarding, true);
replicaContext.shieldStaminaExhausted = true;
assert.equal(replicaContext.window.KTKWorldEntities.getLocalControls().guarding, false);

// Timing split: for a 400ms DB interval with 180ms of the new intent,
// the previous input owns 220ms and the new input owns 180ms.
const elapsedMs = 400;
const newIntentAgeMs = 180;
const newIntentElapsed = Math.min(elapsedMs, newIntentAgeMs);
const previousIntentElapsed = Math.max(0, elapsedMs - newIntentElapsed);
assert.equal(previousIntentElapsed, 220);
assert.equal(newIntentElapsed, 180);

// Client prediction only moves playerVisual. player.x/y always stay server confirmed.
const blockStart = gameState.indexOf("var  player = {x:0,y:0,direction:2,knockback:null,knockbackHeight:0};");
const blockEnd = gameState.indexOf("var  TILE = 72;", blockStart);
assert.ok(blockStart >= 0 && blockEnd > blockStart);
const context = {
  playerMoving: false, playerRunning: false, playerInputX: 0, playerInputY: 0,
  playerStats: { stats: { speed: { value: 2 } } },
  window: { KTKOnline: { connected: true }, KTKEnemySkeleton: { entity: {x:1000,y:1000,defeated:false,collision_radius:18} } }, remotePlayers: new Map(), SPEED: 225, COLLISION_RADIUS: 18
};
vm.createContext(context);
vm.runInContext(gameState.slice(blockStart, blockEnd), context);
context.setAuthoritativePlayerPosition(100, 120, 2, true);
context.playerMoving = true;
context.playerInputX = 1;
context.updateLocalPlayerVisual(1 / 60);
assert.ok(Math.abs(context.playerVisual.x - 103.75) < 0.01);
assert.ok(Math.abs(context.playerVisual.targetX - 103.75) < 0.01,
  "The reconciliation target must advance with local movement.");
assert.equal(context.player.x, 100);
assert.equal(context.playerVisual.direction, 3);

const requestInput = { inputX:1,inputY:0,running:false,guarding:false };
// Local collision prediction must stop at the same 36px player separation.
context.playerVisual.x=100;
context.playerVisual.y=120;
context.playerVisual.targetX=100;
context.playerVisual.targetY=120;
context.remotePlayers.set("other",{x:100,y:120,targetX:130,targetY:120});
context.playerMoving=true;
context.playerInputX=1;
context.playerInputY=0;
context.updateLocalPlayerVisual(0.05);
assert.equal(context.playerVisual.x,100,
  "The visual prediction must not walk through another player's collision radius.");
context.remotePlayers.clear();

// Réplica remota: continua avançando entre snapshots oficiais e para quando
// o servidor confirma a interrupção do movimento.
const remoteMotionStart=replica.indexOf("function updateRemotePlayerMotion(dt)");
const remoteMotionEnd=replica.indexOf("\n  function normalizeRemoteWearables",remoteMotionStart);
assert.ok(remoteMotionStart>=0&&remoteMotionEnd>remoteMotionStart);
let remoteClock=1000;
const remoteMotionContext={
  remotePlayers:new Map([["other",{
    x:0,y:0,targetX:0,targetY:0,velocityX:225,velocityY:0,
    positionReceivedAt:1000,serverMoving:true,walkTime:0
  }]]),
  window:{},performance:{now:()=>remoteClock},SPEED:225,
  KNOCKBACK_SECONDS:0.28,KNOCKBACK_HEIGHT:12,PUNCH_ANIMATION_SECONDS:0.42
};
vm.createContext(remoteMotionContext);
vm.runInContext(
  replica.slice(remoteMotionStart,remoteMotionEnd)+";globalThis.stepRemoteMotion=updateRemotePlayerMotion;",
  remoteMotionContext
);
const remoteEntity=remoteMotionContext.remotePlayers.get("other");
remoteClock=1100;
remoteMotionContext.stepRemoteMotion(0.1);
const remoteXAfterFirstStep=remoteEntity.x;
remoteClock=1200;
remoteMotionContext.stepRemoteMotion(0.1);
assert.ok(remoteEntity.x>remoteXAfterFirstStep+10,
  "O jogador remoto deve continuar avançando entre pacotes do servidor.");
assert.equal(remoteEntity.moving,true);
remoteEntity.targetX=45;
remoteEntity.velocityX=0;
remoteEntity.velocityY=0;
remoteEntity.serverMoving=false;
remoteEntity.positionReceivedAt=remoteClock;
for(let i=0;i<20;i++) {
  remoteClock+=50;
  remoteMotionContext.stepRemoteMotion(0.05);
}
assert.ok(Math.abs(remoteEntity.x-45)<0.75,
  "A réplica deve convergir para a posição oficial quando o servidor confirma que parou.");
assert.equal(remoteEntity.moving,false,
  "A animação remota deve parar depois da confirmação de parada do servidor.");
const staleMotionContext={
  remotePlayers:new Map([["stale",{
    x:0,y:0,targetX:0,targetY:0,velocityX:225,velocityY:0,
    positionReceivedAt:0,serverMoving:true,walkTime:0
  }]]),
  window:{},performance:{now:()=>1000},SPEED:225,
  KNOCKBACK_SECONDS:0.28,KNOCKBACK_HEIGHT:12,PUNCH_ANIMATION_SECONDS:0.42
};
vm.createContext(staleMotionContext);
vm.runInContext(
  replica.slice(remoteMotionStart,remoteMotionEnd)+";globalThis.stepRemoteMotion=updateRemotePlayerMotion;",
  staleMotionContext
);
staleMotionContext.stepRemoteMotion(0.5);
assert.ok(staleMotionContext.remotePlayers.get("stale").x<=102,
  "A extrapolação remota deve ser limitada para não deslizar indefinidamente.");

// A mudança de direção não pode somar a idade da tecla à meia-RTT.
// O trecho após o snapshot é limitado ao menor desses dois intervalos.
function makeIntentTimingContext(ageMs) {
  const timing = {
    playerMoving:true,playerRunning:false,playerInputX:0,playerInputY:-1,
    playerStats:{stats:{speed:{value:2}}},
    window:{KTKOnline:{connected:true}},SPEED:225,COLLISION_RADIUS:18
  };
  vm.createContext(timing);
  vm.runInContext(gameState.slice(blockStart,blockEnd),timing);
  timing.setAuthoritativePlayerPosition(100,120,2,true);
  timing.setAuthoritativePlayerPosition(
    100,120,0,false,400,
    {inputX:1,inputY:0,running:false,guarding:false},
    {inputX:0,inputY:-1,running:false,guarding:false,inputAgeMs:ageMs}
  );
  return timing;
}
const recentIntent=makeIntentTimingContext(100);
assert.ok(Math.abs(recentIntent.playerVisual.targetY-97.5)<0.01,
  "Uma intenção de 100ms não pode ser projetada por 300ms com meia-RTT de 200ms.");
const olderIntent=makeIntentTimingContext(300);
assert.ok(Math.abs(olderIntent.playerVisual.targetY-75)<0.01,
  "Uma intenção mais antiga que a meia-RTT deve ser projetada somente pela meia-RTT.");
const returnedDirection={
  playerMoving:true,playerRunning:false,playerInputX:1,playerInputY:0,
  playerStats:{stats:{speed:{value:2}}},
  window:{KTKOnline:{connected:true}},SPEED:225,COLLISION_RADIUS:18
};
vm.createContext(returnedDirection);
vm.runInContext(gameState.slice(blockStart,blockEnd),returnedDirection);
returnedDirection.setAuthoritativePlayerPosition(100,120,3,true);
returnedDirection.setAuthoritativePlayerPosition(
  100,120,3,false,400,
  {inputX:1,inputY:0,running:false,guarding:false,intentRevision:10},
  {inputX:1,inputY:0,running:false,guarding:false,inputAgeMs:30,intentRevision:12}
);
assert.ok(Math.abs(returnedDirection.playerVisual.targetX-106.75)<0.01,
  "Voltar ao mesmo vetor com outra geração não pode ser confundido com a intenção original.");
const sameIntent=makeIntentTimingContext(0);
sameIntent.setAuthoritativePlayerPosition(
  100,120,0,false,400,
  {inputX:0,inputY:-1,running:false,guarding:false},
  {inputX:0,inputY:-1,running:false,guarding:false,inputAgeMs:0}
);
assert.ok(Math.abs(sameIntent.playerVisual.targetY-75)<0.01,
  "Uma intenção inalterada continua sendo extrapolada pela meia-RTT.");

// Regression: completing a network correction while walking must never snap
// the sprite back to the target captured before those extra movement frames.
const rollbackContext = {
  playerMoving: false, playerRunning: false, playerInputX: 0, playerInputY: 0,
  playerStats: { stats: { speed: { value: 2 } } },
  window: { KTKOnline: { connected: true } }, SPEED: 225, COLLISION_RADIUS: 18
};
vm.createContext(rollbackContext);
vm.runInContext(gameState.slice(blockStart, blockEnd), rollbackContext);
rollbackContext.setAuthoritativePlayerPosition(200, 120, 2, true);
rollbackContext.playerMoving = true;
rollbackContext.playerInputX = 1;
rollbackContext.setAuthoritativePlayerPosition(
  0,120,3,false,0,requestInput,
  { inputX:1,inputY:0,running:false,guarding:false,inputAgeMs:0 }
);
let previousVisualX = rollbackContext.playerVisual.x;
let correctionFrames = 0;
while(rollbackContext.playerVisual.correctionRemaining > 0 && correctionFrames < 5) {
  rollbackContext.updateLocalPlayerVisual(0.05);
  assert.ok(rollbackContext.playerVisual.x >= previousVisualX - 0.01,
    "Finishing a correction must not move a continuously walking player backwards.");
  previousVisualX = rollbackContext.playerVisual.x;
  correctionFrames++;
}
assert.ok(correctionFrames > 0);
assert.ok(rollbackContext.playerVisual.correctionRemaining > 0,
  "A backward correction must remain pending while forward movement is held.");
rollbackContext.playerMoving = false;
rollbackContext.playerInputX = 0;
rollbackContext.updateLocalPlayerVisual(0.05);
assert.ok(rollbackContext.playerVisual.x < previousVisualX + 0.01,
  "A deferred correction may converge after movement stops.");
context.setAuthoritativePlayerPosition(
  103,120,3,false,150,requestInput,
  { inputX:1,inputY:0,running:false,guarding:false,inputAgeMs:0 }
);
assert.equal(context.player.x, 103);
assert.ok(context.playerVisual.correctionRemaining > 0,
  "Small discrepancies must be corrected, not discarded inside a latency dead zone.");
const beforeCorrection = context.playerVisual.x;
context.updateLocalPlayerVisual(0.05);
assert.ok(context.playerVisual.x > beforeCorrection,
  "Half-RTT extrapolation should keep the predicted sprite aligned with server arrival time.");

context.playerVisual.x -= 12;
context.setAuthoritativePlayerPosition(
  103,120,3,false,150,requestInput,
  { inputX:1,inputY:0,running:false,guarding:false,inputAgeMs:0 }
);
assert.ok(context.playerVisual.correctionRemaining > 0);
const beforeSecondCorrection = context.playerVisual.x;
context.updateLocalPlayerVisual(0.05);
assert.ok(context.playerVisual.x > beforeSecondCorrection);

context.playerMoving = false;
context.playerInputX = 0;
context.playerInputY = 0;
context.setAuthoritativePlayerPosition(
  140,120,3,false,0,null,
  { inputX:0,inputY:0,running:false,guarding:false,inputAgeMs:0 }
);
assert.ok(context.playerVisual.correctionRemaining > 0);
const beforeStopCorrection = context.playerVisual.x;
context.updateLocalPlayerVisual(0.05);
assert.notEqual(context.playerVisual.x,beforeStopCorrection,
  "Reconciliation must continue after releasing the key.");

// SQL contract: larger intervals are processed, old/new controls are segmented,
// equipment penalties match the client, and exit/death reset is respected.
assert.match(migration,/least\(\s*0\.75/i);
assert.match(migration,/movement_input_x/);
assert.match(migration,/movement_input_y/);
assert.match(migration,/p_input_age_ms/);
assert.match(migration,/metadata->>'speed_penalty'/);
assert.match(migration,/apply_player_movement_segment/);
assert.match(migration,/v_previous_elapsed/);
assert.match(resetPatch,/coalesce\(\(v_state->>'moving'\)::boolean, false\)/);

assert.match(movement,/p_input_age_ms:\s*inputAgeAtServer/);
assert.match(movement,/payload\.inputAgeMs/);
assert.match(movement,/lastMovementLatencyMs/);
assert.match(movement,/reconcileLocalPosition\?\.\(x, y, direction, latencyMs, requestInput\)/);
assert.match(movement,/stepAccepted && latestMoving/);
assert.match(input,/function sendImmediateMovementIntent\(/);
assert.match(input,/if\(!wasPressed\)[\s\S]*?sendImmediateMovementIntent\(\)/);
assert.match(input,/window\.addEventListener\('keyup'[\s\S]*?sendImmediateMovementIntent\(\)/);
assert.match(renderer,/playerMoving\?playerVisual.direction:player.direction/);
assert.match(gameState,/errorDistance\/correctionSpeed/);
assert.match(gameState,/maxBackward/);
assert.match(gameState,/Math\.min\(oneWayLatencyMs,intentAgeMs\)/);
assert.match(gameState,/requestInput\.intentRevision===controls\.intentRevision/);
assert.match(movement,/intentRevision: payload\.intentRevision/);
assert.match(replica,/localMovementIntentRevision/);
assert.match(gameState,/remote\?\.targetX/);
assert.match(gameState,/remote\?\.targetY/);
assert.match(gameState,/Math.ceil\(Math.max\(Math.abs\(wantedX\),Math.abs\(wantedY\)\)\/6\)/);
assert.match(playerSync,/function compareServerTimestamps\(/);
assert.match(playerSync,/movementInputX:serverState\.movement_input_x/);
assert.match(playerSync,/movementInputY:serverState\.movement_input_y/);
assert.match(playerSync,/movementInputX:row\.state\?\.movement_input_x/);
assert.match(playerSync,/movementInputY:row\.state\?\.movement_input_y/);
assert.match(playerSync,/velocityX,velocityY,positionReceivedAt,serverMoving/);
assert.match(playerSync,/moving:serverState\.moving/);
assert.match(playerSync,/moving:row\.state\?\.moving/);
assert.match(replica,/const extrapolationMs=Math\.min\(450,packetAgeMs\)/);
assert.match(replica,/const hasFreshServerMotion/);
assert.match(playerSync,/applyOwnServerPosition\(row,Number\(state\.lastMovementLatencyMs\)\|\|0\)/);
assert.match(playerSync,/import \{ applyOwnServerPosition \} from "\.\/movement\.js\?v=20261117-remote-motion-006"/);
assert.match(session,/state\.lastLocalKnockbackAt=String\(player\.state\?\.last_knockback_at/);
assert.doesNotMatch(session,/spawnTimestamp/);
assert.match(rootHtml,/20261117-remote-motion-006/);
assert.doesNotMatch(playerSync,/compareServerTimestamps is not defined/);
const timestampHelper = playerSync.slice(
  playerSync.indexOf("function compareServerTimestamps"),
  playerSync.indexOf("function mergeRemoteAppearance")
);
const timestampContext = {};
vm.createContext(timestampContext);
vm.runInContext(timestampHelper + ";globalThis.compare=compareServerTimestamps;", timestampContext);
assert.equal(timestampContext.compare("2026-11-17T21:00:00.000002Z","2026-11-17T21:00:00.000001Z"),1,
  "Remote timestamps must preserve PostgreSQL microsecond ordering.");
assert.equal(timestampContext.compare("2026-11-17T21:00:00.000001Z","2026-11-17T21:00:00.000001Z"),0);
assert.match(online,/sendPosition/);
const onlineModules={online,session,realtime,actions,supabaseClient,playerSync,movement};
for(const [name,source] of Object.entries(onlineModules)) {
  assert.doesNotMatch(source,/20261117-(online-separation-001|movement-authority-002|realtime-entry-fix-001|entry-timeouts-001)/,
    "Módulo ESM ainda usa uma chave antiga: "+name);
  for(const match of source.matchAll(/from\s+["']([^"']+\.js\?v=[^"']+)["']/g)) {
    assert.ok(match[1].endsWith("?v=20261117-remote-motion-006"),
      "Dependência ESM sem a chave única em "+name+": "+match[1]);
  }
}
for(const [path,version] of [
  ["render/world-renderer.js","20261117-remote-motion-006"],
  ["multiplayer/player-replica.js","20261117-remote-motion-006"],
  ["js/game-state.js","20261117-remote-motion-006"],
  ["input/input-controller.js","20261117-remote-motion-006"],
  ["js/online.js","20261117-remote-motion-006"]
]) {
  assert.ok(html.includes("./"+path+"?v="+version),
    "Cache bust ausente: "+path);
}
console.log("Remote player interpolation, bounded server-velocity extrapolation, confirmed stop, and local movement reconciliation passed.");
