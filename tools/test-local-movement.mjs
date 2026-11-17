import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [input, replica, gameState, renderer, movement, online, html, migration, resetPatch,
  playerSync, realtime, sweptMigration, index] = await Promise.all([
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
  read("../online/realtime.js"),
  read("../supabase/migrations/20261117211930_swept_path_player_collisions.sql"),
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
  window: { KTKOnline: { connected: true }, KTKWorldEntities: { entities: () => [] } }, SPEED: 225, COLLISION_RADIUS: 18
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

// Negative reconciliation must never reverse an axis still controlled by the player.
function makeVisualContext(obstacles=[]) {
  const ctx={
    playerMoving:false,playerRunning:false,playerInputX:0,playerInputY:0,
    playerStats:{stats:{speed:{value:2}}},
    window:{KTKOnline:{connected:true},KTKWorldEntities:{entities:()=>obstacles}},
    SPEED:225,COLLISION_RADIUS:18
  };
  vm.createContext(ctx);
  vm.runInContext(gameState.slice(blockStart,blockEnd),ctx);
  return ctx;
}
const directions=[
  {x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1},{x:1,y:1},{x:-1,y:-1}
];
for(const direction of directions) {
  const movementContext=makeVisualContext();
  movementContext.setAuthoritativePlayerPosition(0,0,2,true);
  const length=Math.hypot(direction.x,direction.y);
  movementContext.playerMoving=true;
  movementContext.playerInputX=direction.x;
  movementContext.playerInputY=direction.y;
  movementContext.playerVisual.x=direction.x/length*100;
  movementContext.playerVisual.y=direction.y/length*100;
  movementContext.setAuthoritativePlayerPosition(
    0,0,2,false,0,
    {inputX:direction.x,inputY:direction.y,running:false,guarding:false},
    {inputX:direction.x,inputY:direction.y,running:false,guarding:false,inputAgeMs:0}
  );
  let previousProjection=movementContext.playerVisual.x*direction.x
    +movementContext.playerVisual.y*direction.y;
  for(let frame=0;frame<20;frame++) {
    movementContext.updateLocalPlayerVisual(0.05);
    const projection=movementContext.playerVisual.x*direction.x
      +movementContext.playerVisual.y*direction.y;
    assert.ok(projection>=previousProjection-0.01,
      "Negative correction reversed active direction "+JSON.stringify(direction));
    previousProjection=projection;
  }
  assert.ok(previousProjection>100*length,
    "Movement must continue while opposing correction is pending.");
}

// Swept collision: even a long RTT extrapolation cannot cross another player's circle.
const collisionContext=makeVisualContext([
  {type:"player",x:40,y:0,targetX:40,targetY:0,radius:18}
]);
collisionContext.setAuthoritativePlayerPosition(0,0,2,true);
collisionContext.playerMoving=true;
collisionContext.playerInputX=1;
collisionContext.setAuthoritativePlayerPosition(
  0,0,3,false,750,
  {inputX:1,inputY:0,running:false,guarding:false},
  {inputX:1,inputY:0,running:false,guarding:false,inputAgeMs:0}
);
assert.equal(collisionContext.playerVisual.targetX,0,
  "RTT extrapolation must stop before tunneling through another player.");
collisionContext.updateLocalPlayerVisual(0.05);
assert.equal(collisionContext.playerVisual.x,0,
  "Frame prediction must use the same swept collision rule.");

// Queue own Realtime updates while the step RPC is in flight. Preserve the newest
// database timestamp and reject duplicates delivered after the RPC response.
const movementExecutable=movement
  .replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm,"")
  .replace(/^export\s+/gm,"");
const appliedOwnPositions=[];
const movementState={
  stepInFlight:true,leaving:false,lastPosition:null,pendingOwnPosition:null,
  lastMovementLatencyMs:150
};
const movementHarness={
  state:movementState,
  supabase:{rpc(){throw new Error("Unexpected RPC in test.");}},
  window:{KTKWorldEntities:{reconcileLocalPosition(...args){appliedOwnPositions.push(args);}}},
  console:{warn(){}},Date,Math,setTimeout,clearTimeout,AbortController
};
vm.createContext(movementHarness);
vm.runInContext(movementExecutable,movementHarness,{filename:"online/movement.js"});
const ownOlder={x:10,y:10,direction:3,position_updated_at:"2026-11-17T21:00:00.000001Z"};
const ownNewer={x:20,y:20,direction:3,position_updated_at:"2026-11-17T21:00:00.000002Z"};
assert.equal(movementHarness.compareServerTimestamps(
  ownNewer.position_updated_at,ownOlder.position_updated_at
),1,"Timestamp ordering must retain PostgreSQL microseconds.");
assert.equal(movementHarness.acceptOwnDatabasePosition(ownOlder),false);
assert.equal(movementHarness.acceptOwnDatabasePosition(ownNewer),false);
assert.equal(appliedOwnPositions.length,0,"Realtime cannot compete with an in-flight RPC.");
movementState.stepInFlight=false;
assert.equal(movementHarness.flushPendingOwnPosition(),true);
assert.equal(appliedOwnPositions.length,1);
assert.equal(appliedOwnPositions[0][0],20,"Newest queued position must be applied.");
assert.equal(movementHarness.acceptOwnDatabasePosition(ownOlder),false,
  "Late stale events cannot roll back the accepted position.");

assert.match(sweptMigration,/movement_segment_hits_circle/);
assert.match(sweptMigration,/v_closest_distance<p_radius/);
assert.match(sweptMigration,/ktk_private\.movement_segment_hits_circle/);
assert.match(sweptMigration,/from public,anon,authenticated/);
assert.match(playerSync,/acceptOwnDatabasePosition\(row\)/);
assert.match(playerSync,/compareServerTimestamps\(positionTimestamp/);
assert.match(playerSync,/movement-pipeline-004/);
assert.match(realtime,/player-sync\.js\?v=20261117-movement-pipeline-004/);
assert.match(movement,/export function compareServerTimestamps/);
assert.match(movement,/flushPendingOwnPosition\(\)/);
assert.match(index,/campo_livre_atualizado\.html\?v=20261117-movement-pipeline-004/);

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
  ["render/world-renderer.js","20261117-movement-authority-002"],
  ["multiplayer/player-replica.js","20261117-movement-authority-002"],
  ["js/game-state.js","20261117-movement-pipeline-004"],
  ["input/input-controller.js","20261117-movement-authority-002"],
  ["js/online.js","20261117-movement-pipeline-004"]
]) {
  assert.ok(html.includes("./"+path+"?v="+version),
    "Cache bust ausente: "+path);
}
assert.match(gameState,/moveLocalPlayerSegment/);
assert.match(gameState,/movementSegmentHitsCircle/);
assert.match(gameState,/if\(\(playerInputX>0&&correctionX<0\)/);
assert.match(index,/movement-pipeline-004/);
assert.match(index,/campo_livre_atualizado\.html\?v=20261117-movement-pipeline-004/);
console.log("Movement prediction, monotonic reconciliation, own-position ordering, swept collision and cache redirect passed.");
