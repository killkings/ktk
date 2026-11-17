import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [input, replica, gameState, renderer, movement, online, html] = await Promise.all([
  read("../input/input-controller.js"),
  read("../multiplayer/player-replica.js"),
  read("../js/game-state.js"),
  read("../render/world-renderer.js"),
  read("../online/movement.js"),
  read("../js/online.js"),
  read("../campo_livre_atualizado.html")
]);

const keys = new Set(["w", "d"]);
const stamina = { value: 60 };
const replicaContext = {
  window: {}, keys,
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
assert.equal(controls.inputX, 1);
assert.equal(controls.inputY, -1);
assert.equal(controls.running, false);
keys.add("shift");
assert.equal(replicaContext.window.KTKWorldEntities.getLocalControls().running, true);
stamina.value = 0;
assert.equal(replicaContext.window.KTKWorldEntities.getLocalControls().running, false);
stamina.value = 60;
replicaContext.rightMouseHeld = true;
assert.equal(replicaContext.window.KTKWorldEntities.getLocalControls().guarding, true);
replicaContext.shieldStaminaExhausted = true;
assert.equal(replicaContext.window.KTKWorldEntities.getLocalControls().guarding, false);
assert.match(replica, /reconcileLocalPosition:\(x,y,direction,latencyMs=0\)=>setAuthoritativePlayerPosition\(x,y,direction,false,latencyMs\)/);

const blockStart = gameState.indexOf("var  player = {x:0,y:0,direction:2,knockback:null,knockbackHeight:0};");
const blockEnd = gameState.indexOf("var  TILE = 72;", blockStart);
assert.ok(blockStart >= 0 && blockEnd > blockStart, "Bloco de posição local encontrado.");
const predictionSource = gameState.slice(blockStart, blockEnd);
const predictionContext = {
  playerMoving: false, playerInputX: 0, playerInputY: 0,
  playerStats: { stats: { speed: { value: 2 } } },
  window: { KTKOnline: { connected: true } }, SPEED: 225, COLLISION_RADIUS: 18
};
vm.createContext(predictionContext);
vm.runInContext(predictionSource, predictionContext);
predictionContext.setAuthoritativePlayerPosition(100, 120, 2, true);
predictionContext.playerMoving = true;
predictionContext.playerInputX = 1;
predictionContext.updateLocalPlayerVisual(1 / 60);
assert.ok(Math.abs(predictionContext.playerVisual.x - 103.75) < 0.01);
assert.equal(predictionContext.player.x, 100, "A previsão não pode alterar a coordenada oficial.");
assert.equal(predictionContext.playerVisual.direction, 3);
predictionContext.setAuthoritativePlayerPosition(70, 120, 1, false, 40);
assert.equal(predictionContext.player.x, 70);
assert.ok(predictionContext.playerVisual.correctionRemaining > 0,
  "Divergência do servidor precisa ser reconciliada.");
const beforeCorrection = predictionContext.playerVisual.x;
predictionContext.updateLocalPlayerVisual(0.05);
assert.ok(predictionContext.playerVisual.x < beforeCorrection,
  "A reconciliação deve corrigir a previsão em direção à posição oficial.");

assert.match(input, /function sendImmediateMovementIntent\(/);
assert.match(input, /if\(!wasPressed\)[\s\S]*?sendImmediateMovementIntent\(\)/);
assert.match(input, /window\.addEventListener\('keyup'[\s\S]*?sendImmediateMovementIntent\(\)/);
assert.match(input, /if\(hadMovementIntent\) sendImmediateMovementIntent\(\)/);
assert.match(replica, /keys\.has\('w'\)/);
assert.doesNotMatch(replica, /inputX:playerInputX/);
assert.match(gameState, /playerVisual\.x\+=[\s\S]*?playerInputX\/inputLength/);
assert.match(gameState, /latencyTolerance/);
assert.match(renderer, /playerMoving\?playerVisual\.direction:player\.direction/);
assert.match(movement, /Date\.now\(\) - requestStartedAt/);
assert.match(movement, /reconcileLocalPosition\?\.\(x, y, direction, latencyMs\)/);
assert.match(online, /sendPosition/);
for (const path of [
  "render/world-renderer.js", "multiplayer/player-replica.js",
  "js/game-state.js", "input/input-controller.js", "js/online.js"
]) {
  assert.ok(html.includes("./" + path + "?v=20261117-client-movement-001"),
    "Cache bust ausente: " + path);
}
console.log("Immediate local prediction and server reconciliation passed.");
