export const WORLD_ID = "main";
export const SIMULATION_HZ = 30;
export const SNAPSHOT_HZ = 20;
export const PLAYER_RADIUS = 18;
export const INPUT_TIMEOUT_MS = 350;
const MAX_SPEED = 500;
const MAX_COORDINATE = 100000;

const finite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const clone = value => value == null ? {} : JSON.parse(JSON.stringify(value));

function directionFromInput(inputX, inputY, previous = 2) {
  if (Math.abs(inputX) > Math.abs(inputY)) return inputX > 0 ? 3 : 1;
  if (Math.abs(inputY) > 0) return inputY > 0 ? 2 : 0;
  return previous;
}

function itemId(item) {
  return String(item?.item_id || item?.itemId || item?.id || "");
}

export class AuthoritativeWorld {
  constructor({ now = () => performance.now() } = {}) {
    this.now = now;
    this.tickNumber = 0;
    this.players = new Map();
    this.entities = new Map();
    this.catalog = new Map();
  }

  setCatalog(items) {
    this.catalog.clear();
    for (const item of Array.isArray(items) ? items : []) {
      if (item?.item_id) this.catalog.set(String(item.item_id), item);
    }
  }

  setEntities(rows) {
    this.entities.clear();
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!row?.entity_id || !Number.isFinite(Number(row.x)) || !Number.isFinite(Number(row.y))) continue;
      this.entities.set(String(row.entity_id), {
        id: String(row.entity_id),
        type: String(row.entity_type || ""),
        x: finite(row.x),
        y: finite(row.y),
        radius: Math.max(0, finite(row.collision_radius)),
        state: clone(row.state)
      });
    }
  }

  upsertFromDatabase(row, profile = {}) {
    const id = String(row?.user_id || "");
    if (!id || row?.world_id !== WORLD_ID || row?.is_alive !== true) return null;
    const existing = this.players.get(id);
    const databasePositionUpdatedAt = String(row.position_updated_at || "");
    let x = finite(row.x);
    let y = finite(row.y);

    if (existing) {
      // A newer database position that did not originate from our last flush
      // represents a discrete server-side displacement (for example knockback).
      const externalPositionChange = Boolean(
        existing.lastPersistedPositionAt &&
        databasePositionUpdatedAt &&
        databasePositionUpdatedAt !== existing.lastPersistedPositionAt
      );
      if (!externalPositionChange) {
        x = existing.x;
        y = existing.y;
      } else {
        existing.velocityX = 0;
        existing.velocityY = 0;
      }

      const databaseState = clone(row.state);
      const movementKeys = [
        "moving", "running", "guarding",
        "movement_input_x", "movement_input_y",
        "movement_running", "movement_guarding"
      ];
      for (const key of movementKeys) {
        if (existing.connected) {
          if (existing.state[key] !== undefined) databaseState[key] = existing.state[key];
          else delete databaseState[key];
        }
      }

      Object.assign(existing, {
        x, y,
        direction: externalPositionChange ? finite(row.direction, existing.direction) : existing.direction,
        state: databaseState,
        displayName: String(profile.display_name || existing.displayName || "Aventureiro").slice(0, 24),
        character: profile.character && typeof profile.character === "object"
          ? clone(profile.character) : existing.character,
        clanColor: profile.clan_color || existing.clanColor || null,
        databasePositionUpdatedAt: databasePositionUpdatedAt || existing.databasePositionUpdatedAt,
        lastPersistedPositionAt: externalPositionChange
          ? databasePositionUpdatedAt
          : existing.lastPersistedPositionAt
      });
      return existing;
    }

    const state = clone(row.state);
    return this.players.set(id, {
      id,
      worldId: WORLD_ID,
      x: clamp(x, -MAX_COORDINATE, MAX_COORDINATE),
      y: clamp(y, -MAX_COORDINATE, MAX_COORDINATE),
      direction: clamp(finite(row.direction, 2), 0, 3),
      state,
      displayName: String(profile.display_name || "Aventureiro").slice(0, 24),
      character: profile.character && typeof profile.character === "object"
        ? clone(profile.character) : {},
      clanColor: profile.clan_color || null,
      connected: false,
      isAlive: true,
      inputX: 0,
      inputY: 0,
      wantsRunning: false,
      wantsGuarding: false,
      running: false,
      guarding: false,
      moving: false,
      velocityX: 0,
      velocityY: 0,
      lastInputSequence: 0,
      lastInputAt: this.now(),
      lastPersistedPositionAt: databasePositionUpdatedAt,
      databasePositionUpdatedAt
    }).get(id);
  }

  connectPlayer(userId) {
    const player = this.players.get(String(userId));
    if (!player || !player.isAlive) return null;
    player.connected = true;
    player.inputX = 0;
    player.inputY = 0;
    player.wantsRunning = false;
    player.wantsGuarding = false;
    player.running = false;
    player.guarding = false;
    player.moving = false;
    player.velocityX = 0;
    player.velocityY = 0;
    player.lastInputAt = this.now();
    player.state.moving = false;
    player.state.running = false;
    player.state.guarding = false;
    return player;
  }

  disconnectPlayer(userId) {
    const player = this.players.get(String(userId));
    if (!player) return null;
    player.connected = false;
    player.inputX = 0;
    player.inputY = 0;
    player.wantsRunning = false;
    player.wantsGuarding = false;
    player.running = false;
    player.guarding = false;
    player.moving = false;
    player.velocityX = 0;
    player.velocityY = 0;
    player.state.moving = false;
    player.state.running = false;
    player.state.guarding = false;
    return player;
  }

  receiveInput(userId, packet, receivedAt = this.now()) {
    const player = this.players.get(String(userId));
    if (!player || !player.connected || !player.isAlive) return false;
    const sequence = Number(packet?.sequence);
    if (!Number.isSafeInteger(sequence) || sequence <= player.lastInputSequence) return false;

    const inputX = Math.trunc(finite(packet?.inputX, 0));
    const inputY = Math.trunc(finite(packet?.inputY, 0));
    if (![-1, 0, 1].includes(inputX) || ![-1, 0, 1].includes(inputY)) return false;

    player.lastInputSequence = sequence;
    player.lastInputAt = receivedAt;
    player.inputX = inputX;
    player.inputY = inputY;
    player.wantsRunning = Boolean(packet?.running);
    player.wantsGuarding = Boolean(packet?.guarding);
    return true;
  }

  markPersisted(rows) {
    for (const row of Array.isArray(rows) ? rows : []) {
      const player = this.players.get(String(row?.user_id || ""));
      if (player && row.position_updated_at) {
        player.lastPersistedPositionAt = String(row.position_updated_at);
        player.databasePositionUpdatedAt = String(row.position_updated_at);
      }
    }
  }

  applyExternalPosition(userId, row) {
    const player = this.players.get(String(userId));
    if (!player || !row) return false;
    const x = Number(row.x);
    const y = Number(row.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    player.x = clamp(x, -MAX_COORDINATE, MAX_COORDINATE);
    player.y = clamp(y, -MAX_COORDINATE, MAX_COORDINATE);
    player.direction = clamp(finite(row.direction, player.direction), 0, 3);
    player.velocityX = 0;
    player.velocityY = 0;
    player.lastPersistedPositionAt = String(row.position_updated_at || "");
    player.databasePositionUpdatedAt = player.lastPersistedPositionAt;
    return true;
  }

  getSpeedPenalty(player) {
    let penalty = 0;
    const wearables = player.state?.wearables || {};
    for (const item of Object.values(wearables)) {
      const id = itemId(item);
      if (!id) continue;
      const definition = this.catalog.get(id);
      if (!definition) continue;
      const maximum = finite(definition.max_durability, 0);
      const durability = finite(item?.durability, maximum);
      if (maximum > 0 && durability <= 0) continue;
      penalty += Math.max(0, finite(definition.metadata?.speed_penalty, 0));
    }
    return penalty;
  }

  canGuard(player) {
    const inventory = Array.isArray(player.state?.inventory) ? player.state.inventory : [];
    const selectedSlot = clamp(Math.trunc(finite(player.state?.selected_slot, 0)), 0, Math.max(0, inventory.length - 1));
    const selected = this.catalog.get(itemId(inventory[selectedSlot]));
    if (selected?.two_handed) return false;
    return inventory.some(item => this.catalog.get(itemId(item))?.item_type === "shield");
  }

  isBlocked(player, x, y) {
    for (const other of this.players.values()) {
      if (other.id === player.id || !other.connected || !other.isAlive) continue;
      if (Math.hypot(x - other.x, y - other.y) < PLAYER_RADIUS * 2) return true;
    }
    for (const entity of this.entities.values()) {
      const isSolid = entity.type === "obstacle" ||
        (entity.type === "resource" && String(entity.state?.status || "ready") === "ready") ||
        (entity.type === "enemy" && !Boolean(entity.state?.defeated));
      if (!isSolid) continue;
      if (Math.hypot(x - entity.x, y - entity.y) < PLAYER_RADIUS + entity.radius) return true;
    }
    return false;
  }

  moveAxis(player, amount, axis) {
    if (!Number.isFinite(amount) || Math.abs(amount) < 1e-9) return 0;
    const steps = Math.max(1, Math.ceil(Math.abs(amount) / 6));
    const step = amount / steps;
    let moved = 0;
    for (let index = 0; index < steps; index++) {
      const x = player.x + (axis === "x" ? step : 0);
      const y = player.y + (axis === "y" ? step : 0);
      if (this.isBlocked(player, x, y)) break;
      player.x = x;
      player.y = y;
      moved += step;
    }
    return moved;
  }

  tick(deltaSeconds, now = this.now()) {
    const dt = clamp(finite(deltaSeconds, 0), 0, 0.05);
    if (dt <= 0) return;
    this.tickNumber += 1;

    const orderedPlayers = [...this.players.values()]
      .filter(player => player.connected && player.isAlive)
      .sort((a, b) => a.id.localeCompare(b.id));

    for (const player of orderedPlayers) {
      if (now - finite(player.lastInputAt, now) > INPUT_TIMEOUT_MS) {
        player.inputX = 0;
        player.inputY = 0;
        player.wantsRunning = false;
        player.wantsGuarding = false;
      }

      const inputX = player.inputX;
      const inputY = player.inputY;
      const inputLength = Math.hypot(inputX, inputY);
      const hasMovementIntent = inputLength > 0;
      const stamina = Math.max(0, finite(player.state?.stamina, 100));
      const guarding = player.wantsGuarding && this.canGuard(player) && stamina > 0.5;
      const running = player.wantsRunning && hasMovementIntent && stamina > 0.5;

      player.direction = directionFromInput(inputX, inputY, player.direction);
      let speed = 0;
      if (hasMovementIntent) {
        let speedLevel = running ? 3 : 2;
        if (guarding) speedLevel *= 0.5;
        speed = 225 * Math.max(1, speedLevel - this.getSpeedPenalty(player)) / 2;
      }
      speed = clamp(speed, 0, MAX_SPEED);
      const distance = speed * dt;
      const dx = inputLength ? (inputX / inputLength) * distance : 0;
      const dy = inputLength ? (inputY / inputLength) * distance : 0;

      const movedX = this.moveAxis(player, dx, "x");
      const movedY = this.moveAxis(player, dy, "y");
      player.velocityX = movedX / dt;
      player.velocityY = movedY / dt;
      player.moving = Math.hypot(player.velocityX, player.velocityY) > 1;
      player.running = running && player.moving;
      player.guarding = guarding;
      player.state.moving = player.moving;
      player.state.running = player.running;
      player.state.guarding = player.guarding;
      player.state.movement_input_x = inputX;
      player.state.movement_input_y = inputY;
      player.state.movement_running = player.running;
      player.state.movement_guarding = guarding;
    }
  }

  getConnectedPlayers() {
    return [...this.players.values()].filter(player => player.connected && player.isAlive);
  }

  getPersistablePlayers() {
    return [...this.players.values()].filter(player => player.isAlive);
  }

  serializePlayer(player) {
    const state = player.state || {};
    return {
      user_id: player.id,
      x: player.x,
      y: player.y,
      direction: player.direction,
      velocityX: player.velocityX,
      velocityY: player.velocityY,
      moving: player.moving,
      running: player.running,
      guarding: player.guarding,
      lastInputSequence: player.lastInputSequence,
      display_name: player.displayName,
      character: player.character,
      clan_color: player.clanColor,
      wearables: state.wearables || {},
      combat_stats: {
        health: finite(state.health, 100),
        maxHealth: finite(state.max_health, 100),
        stamina: finite(state.stamina, 100),
        maxStamina: finite(state.max_stamina, 100),
        satiety: finite(state.satiety, 99),
        hydration: finite(state.hydration, 99)
      }
    };
  }

  snapshot() {
    return {
      type: "snapshot",
      worldId: WORLD_ID,
      tick: this.tickNumber,
      serverTime: Date.now(),
      players: this.getConnectedPlayers().map(player => this.serializePlayer(player))
    };
  }

  welcome(userId) {
    const player = this.players.get(String(userId));
    return {
      type: "welcome",
      worldId: WORLD_ID,
      userId: String(userId),
      tick: this.tickNumber,
      serverTime: Date.now(),
      player: player ? this.serializePlayer(player) : null,
      players: this.getConnectedPlayers().map(item => this.serializePlayer(item)),
      entities: [...this.entities.values()].map(entity => ({
        entity_id: entity.id,
        entity_type: entity.type,
        x: entity.x,
        y: entity.y,
        collision_radius: entity.radius,
        state: entity.state
      }))
    };
  }
}
