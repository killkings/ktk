import test from "node:test";
import assert from "node:assert/strict";
import { AuthoritativeWorld, INPUT_TIMEOUT_MS } from "../world.mjs";

function makeWorld({ stamina = 100, catalog = [] } = {}) {
  let clock = 1000;
  const world = new AuthoritativeWorld({ now: () => clock });
  world.setCatalog(catalog);
  world.upsertFromDatabase({
    user_id: "player-a",
    world_id: "main",
    is_alive: true,
    x: 0,
    y: 0,
    direction: 2,
    position_updated_at: "2026-11-17T00:00:00.000Z",
    state: { stamina, inventory: [null, null], wearables: {} }
  }, { display_name: "A", character: {} });
  world.connectPlayer("player-a");
  return {
    world,
    setTime(value) { clock = value; },
    now() { return clock; }
  };
}

function runFor(world, now, seconds, input) {
  let sequence = 1;
  world.receiveInput("player-a", { sequence, ...input }, now);
  const steps = Math.round(seconds * 30);
  for (let index = 1; index <= steps; index++) {
    if (index % 3 === 0) {
      sequence += 1;
      world.receiveInput("player-a", { sequence, ...input }, now + (index - 1) * (1000 / 30));
    }
    world.tick(1 / 30, now + index * (1000 / 30));
  }
}

test("walking is simulated at the server's fixed 225 px/s speed", () => {
  const { world, now } = makeWorld();
  runFor(world, now(), 1, { inputX: 1, inputY: 0, running: false, guarding: false });
  const player = world.players.get("player-a");
  assert.ok(Math.abs(player.x - 225) < 1);
  assert.equal(player.y, 0);
  assert.equal(player.direction, 3);
});

test("running is simulated at 337.5 px/s", () => {
  const { world, now } = makeWorld();
  runFor(world, now(), 1, { inputX: 1, inputY: 0, running: true, guarding: false });
  assert.ok(Math.abs(world.players.get("player-a").x - 337.5) < 1);
});

test("diagonal movement is normalized and does not gain speed", () => {
  const { world, now } = makeWorld();
  runFor(world, now(), 1, { inputX: 1, inputY: -1, running: false, guarding: false });
  const player = world.players.get("player-a");
  assert.ok(Math.abs(Math.hypot(player.x, player.y) - 225) < 1);
});

test("guarding without a shield is rejected by the authoritative simulation", () => {
  const { world, now } = makeWorld();
  runFor(world, now(), 1, { inputX: 1, inputY: 0, running: false, guarding: true });
  assert.ok(Math.abs(world.players.get("player-a").x - 225) < 1);
  assert.equal(world.players.get("player-a").guarding, false);
});

test("guarding with a shield halves walking speed", () => {
  const { world, now } = makeWorld({
    catalog: [{ item_id: "shield", item_type: "shield", max_durability: 100, metadata: {} }]
  });
  const player = world.players.get("player-a");
  player.state.inventory = [{ item_id: "shield", durability: 100 }, null];
  runFor(world, now(), 1, { inputX: 1, inputY: 0, running: false, guarding: true });
  assert.ok(Math.abs(player.x - 112.5) < 1);
  assert.equal(player.guarding, true);
});

test("old or duplicate input sequence numbers are ignored", () => {
  const { world, now } = makeWorld();
  assert.equal(world.receiveInput("player-a", {
    sequence: 10, inputX: 1, inputY: 0
  }, now()), true);
  assert.equal(world.receiveInput("player-a", {
    sequence: 9, inputX: -1, inputY: 0
  }, now() + 5), false);
  assert.equal(world.players.get("player-a").inputX, 1);
});

test("movement stops when the client stops sending heartbeats", () => {
  const { world, now } = makeWorld();
  world.receiveInput("player-a", {
    sequence: 1, inputX: 1, inputY: 0, running: false, guarding: false
  }, now());
  world.tick(1 / 30, now() + 50);
  const beforeTimeout = world.players.get("player-a").x;
  world.tick(1 / 30, now() + INPUT_TIMEOUT_MS + 50);
  const stopped = world.players.get("player-a");
  assert.equal(stopped.velocityX, 0);
  assert.equal(stopped.moving, false);
  assert.equal(stopped.x, beforeTimeout);
});

test("static enemy collision blocks the player without tunneling", () => {
  const { world, now } = makeWorld();
  world.setEntities([{
    entity_id: "enemy",
    entity_type: "enemy",
    x: 60,
    y: 0,
    collision_radius: 14,
    state: { defeated: false }
  }]);
  runFor(world, now(), 1, { inputX: 1, inputY: 0, running: false, guarding: false });
  assert.ok(world.players.get("player-a").x < 28);
});

test("connected players collide with each other", () => {
  const { world, now } = makeWorld();
  world.upsertFromDatabase({
    user_id: "player-b",
    world_id: "main",
    is_alive: true,
    x: 80,
    y: 0,
    direction: 1,
    position_updated_at: "2026-11-17T00:00:00.000Z",
    state: { stamina: 100, inventory: [null, null], wearables: {} }
  }, { display_name: "B", character: {} });
  world.connectPlayer("player-b");
  runFor(world, now(), 1, { inputX: 1, inputY: 0, running: false, guarding: false });
  assert.ok(world.players.get("player-a").x <= 44);
});
