/* Rede simples de posições: caminhada local no navegador, Broadcast para os pares e checkpoint no banco. */
import { state } from "./state.js?v=20261117-walk-v1";
import { supabase } from "./supabase-client.js?v=20261117-walk-v1";

const MOVING_BROADCAST_INTERVAL = 80;
const IDLE_BROADCAST_INTERVAL = 700;
const MOVING_CHECKPOINT_INTERVAL = 500;
const IDLE_CHECKPOINT_INTERVAL = 2000;

let lastBroadcastAt = 0;
let lastBroadcastState = "";
let lastBroadcastX = NaN;
let lastBroadcastY = NaN;
let sequence = 0;
let checkpointInFlight = false;
let pendingCheckpoint = null;

function readLocalPosition() {
  const local = window.player;
  const x = Number(local?.x);
  const y = Number(local?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const inputX = Math.max(-1, Math.min(1, Math.trunc(Number(window.playerInputX) || 0)));
  const inputY = Math.max(-1, Math.min(1, Math.trunc(Number(window.playerInputY) || 0)));
  const moving = Boolean(window.playerMoving && (inputX !== 0 || inputY !== 0));
  const running = Boolean(window.playerRunning && moving);
  const guarding = Boolean(
    window.rightMouseHeld &&
    !window.shieldStaminaExhausted &&
    Array.isArray(window.inventory) &&
    window.inventory.some(item => item?.equipmentClass === "shield")
  );

  return {
    user_id: state.user?.id || "",
    session_id: state.sessionId,
    display_name: state.displayName || "Aventureiro",
    x, y,
    direction: Math.max(0, Math.min(3, Math.trunc(Number(local.direction) || 0))),
    input_x: inputX,
    input_y: inputY,
    moving, running, guarding
  };
}

function persistPosition(snapshot, force = false) {
  if (checkpointInFlight) {
    pendingCheckpoint = snapshot;
    return;
  }

  checkpointInFlight = true;
  state.lastPositionCheckpointAt = performance.now();
  const args = {
    p_x: snapshot.x,
    p_y: snapshot.y,
    p_direction: snapshot.direction,
    p_moving: snapshot.moving,
    p_running: snapshot.running,
    p_guarding: snapshot.guarding,
    p_input_x: snapshot.input_x,
    p_input_y: snapshot.input_y
  };

  void supabase.rpc("ktk_checkpoint_position", args)
    .then(({ error }) => {
      if (error) console.warn("KTK position checkpoint:", error.message);
    })
    .catch(error => console.warn("KTK position checkpoint:", error?.message || error))
    .finally(() => {
      checkpointInFlight = false;
      const pending = pendingCheckpoint;
      pendingCheckpoint = null;
      if (pending && state.online && state.joined && !state.leaving) {
        persistPosition(pending, true);
      }
    });
}

export function sendPosition(force = false) {
  if (state.leaving || !state.online || !state.channel || !state.joined) return;
  const snapshot = readLocalPosition();
  if (!snapshot || !snapshot.user_id) return;

  const now = performance.now();
  const stateSignature = [
    snapshot.direction, snapshot.moving, snapshot.running, snapshot.guarding
  ].join(":");
  const stateChanged = stateSignature !== lastBroadcastState;
  const elapsed = now - lastBroadcastAt;
  const moved = !Number.isFinite(lastBroadcastX) ||
    Math.hypot(snapshot.x - lastBroadcastX, snapshot.y - lastBroadcastY) > 0.5;
  const broadcastInterval = snapshot.moving
    ? MOVING_BROADCAST_INTERVAL
    : IDLE_BROADCAST_INTERVAL;

  if (force || stateChanged || (moved && elapsed >= broadcastInterval) || elapsed >= IDLE_BROADCAST_INTERVAL) {
    sequence += 1;
    const payload = {
      ...snapshot,
      sequence,
      sent_at: Date.now()
    };
    lastBroadcastAt = now;
    lastBroadcastState = stateSignature;
    lastBroadcastX = snapshot.x;
    lastBroadcastY = snapshot.y;

    void state.channel.send({
      type: "broadcast",
      event: "player_position",
      payload
    }).then(status => {
      if (status !== "ok") console.warn("KTK position broadcast:", status);
    }).catch(error => console.warn("KTK position broadcast:", error?.message || error));
  }

  const checkpointInterval = snapshot.moving
    ? MOVING_CHECKPOINT_INTERVAL
    : IDLE_CHECKPOINT_INTERVAL;
  if (force || now - (Number(state.lastPositionCheckpointAt) || 0) >= checkpointInterval) {
    persistPosition(snapshot, force);
  }
}

export function resetMovementNetwork() {
  lastBroadcastAt = 0;
  lastBroadcastState = "";
  lastBroadcastX = NaN;
  lastBroadcastY = NaN;
  sequence = 0;
  pendingCheckpoint = null;
}
