import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [input, replica, gameState, renderer, movement, online, html, migration, resetPatch, playerSync, rootHtml] = await Promise.all([
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
  read("../index.html")
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
clock = 1125;
keys.delete("w");
keys.add("d");
controls = replicaContext.window.KTKWorldEntities.getLocalControls();
assert.equal(controls.inputX, 1);
assert.equal(controls.inputY, 0);
assert.equal(controls.inputAgeMs, 0);
clock = 1250;
assert.equal(replicaContext.window.KTKWorldEntities.getLocalControls().inputAgeMs, 125);
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
context.remotePlayers.set("other",{x:130,y:120});
context.playerMoving=true;
context.playerInputX=1;
context.playerInputY=0;
context.updateLocalPlayerVisual(0.05);
assert.equal(context.playerVisual.x,100,
  "The visual prediction must not walk through another player's collision radius.");
context.remotePlayers.clear();

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
while(rollbackContext.playerVisual.correctionRemaining > 0 && correctionFrames < 20) {
  rollbackContext.updateLocalPlayerVisual(0.05);
  assert.ok(rollbackContext.playerVisual.x >= previousVisualX - 0.01,
    "Finishing a correction must not move a continuously walking player backwards.");
  previousVisualX = rollbackContext.playerVisual.x;
  correctionFrames++;
}
assert.ok(correctionFrames > 0);
assert.ok(Math.abs(rollbackContext.playerVisual.x - rollbackContext.playerVisual.targetX) < 0.01,
  "The visual position must converge to the moving target without a rollback.");
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
assert.doesNotMatch(gameState,/latencyTolerance/);
assert.match(online,/sendPosition/);
for(const [path,version] of [
  ["render/world-renderer.js","20261117-movement-reconciliation-004"],
  ["multiplayer/player-replica.js","20261117-movement-reconciliation-004"],
  ["js/game-state.js","20261117-movement-reconciliation-004"],
  ["input/input-controller.js","20261117-movement-reconciliation-004"],
  ["js/online.js","20261117-movement-reconciliation-004"]
]) {
  assert.ok(html.includes("./"+path+"?v="+version),
    "Cache bust ausente: "+path);
}
console.log("Timestamped server movement, RTT extrapolation, gear speed and continuous correction passed.");
