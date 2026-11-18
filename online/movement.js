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
let checkpointPromise = null;
let pendingCheckpoint = null;

function readLocalPosition() {
  const local = window.player;
  const roomSize=window.KTKWorldMap?.regionSize||{width:window.canvas?.clientWidth||window.innerWidth,height:window.canvas?.clientHeight||window.innerHeight};
  const roomCamera=window.camera||{x:0,y:0};
  const roomWidth=Math.max(1,Number(roomSize.width)||1920), roomHeight=Math.max(1,Number(roomSize.height)||1080);
  // A rede usa coordenadas globais, independentes da sala visível no cliente.
  const x=Number(local?.x)+Number(roomCamera.x||0)*roomWidth;
  const y=Number(local?.y)+Number(roomCamera.y||0)*roomHeight;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const inputX = Math.max(-1, Math.min(1, Math.trunc(Number(window.playerInputX) || 0)));
  const inputY = Math.max(-1, Math.min(1, Math.trunc(Number(window.playerInputY) || 0)));
  const moving = Boolean(window.playerMoving && (inputX !== 0 || inputY !== 0));
  const running = Boolean(window.playerRunning && moving);
  const guarding = Boolean(
    window.rightMouseHeld &&
    !window.shieldStaminaExhausted &&
    Boolean(window.getBlockingShield?.())
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

function checkpointArguments(snapshot) {
  return {
    p_x: snapshot.x,
    p_y: snapshot.y,
    p_direction: snapshot.direction,
    p_moving: snapshot.moving,
    p_running: snapshot.running,
    p_guarding: snapshot.guarding,
    p_input_x: snapshot.input_x,
    p_input_y: snapshot.input_y
  };
}

function persistPosition(snapshot) {
  if (checkpointInFlight) {
    pendingCheckpoint = snapshot;
    return checkpointPromise || Promise.resolve(false);
  }

  checkpointInFlight = true;
  state.lastPositionCheckpointAt = performance.now();
  const request = supabase.rpc("ktk_checkpoint_position", checkpointArguments(snapshot))
    .then(({ error }) => {
      if (error) {
        console.warn("KTK position checkpoint:", error.message);
        return false;
      }
      return true;
    })
    .catch(error => {
      console.warn("KTK position checkpoint:", error?.message || error);
      return false;
    })
    .finally(() => {
      checkpointInFlight = false;
      const pending = pendingCheckpoint;
      pendingCheckpoint = null;
      if (pending && state.online && state.joined && !state.leaving) {
        void persistPosition(pending);
      } else {
        checkpointPromise = null;
      }
    });

  checkpointPromise = request;
  return request;
}

async function flushPositionCheckpoint(snapshot) {
  let success = await persistPosition(snapshot);
  // Um checkpoint que já estava em voo pode ter sido seguido por este snapshot
  // na fila. Aguarda também esse segundo write para não atacar com coordenadas antigas.
  while (checkpointInFlight || pendingCheckpoint) {
    const current = checkpointPromise;
    if (!current) {
      if (pendingCheckpoint) {
        const pending = pendingCheckpoint;
        pendingCheckpoint = null;
        success = (await persistPosition(pending)) && success;
        continue;
      }
      break;
    }
    const result = await current;
    success = result && success;
  }
  return Boolean(success);
}

function broadcastPosition(snapshot) {
  if (!state.channel || !state.online || !state.joined || state.leaving) return false;
  const now = performance.now();
  const stateSignature = [
    snapshot.direction, snapshot.input_x, snapshot.input_y,
    snapshot.moving, snapshot.running, snapshot.guarding
  ].join(":");
  sequence += 1;
  const payload = { ...snapshot, sequence, sent_at: Date.now() };
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
  return true;
}

export function sendPosition(force = false) {
  if (state.leaving || !state.online || !state.channel || !state.joined) return;
  const snapshot = readLocalPosition();
  if (!snapshot || !snapshot.user_id) return;

  const now = performance.now();
  const stateSignature = [
    snapshot.direction, snapshot.input_x, snapshot.input_y,
    snapshot.moving, snapshot.running, snapshot.guarding
  ].join(":");
  const stateChanged = stateSignature !== lastBroadcastState;
  const elapsed = now - lastBroadcastAt;
  const moved = !Number.isFinite(lastBroadcastX) ||
    Math.hypot(snapshot.x - lastBroadcastX, snapshot.y - lastBroadcastY) > 0.5;
  const broadcastInterval = snapshot.moving
    ? MOVING_BROADCAST_INTERVAL
    : IDLE_BROADCAST_INTERVAL;

  if (force || stateChanged || (moved && elapsed >= broadcastInterval) || elapsed >= IDLE_BROADCAST_INTERVAL) {
    broadcastPosition(snapshot);
  }

  const checkpointInterval = snapshot.moving
    ? MOVING_CHECKPOINT_INTERVAL
    : IDLE_CHECKPOINT_INTERVAL;
  // Mudanças de estado de movimento também são registradas logo no início/fim
  // do deslocamento; a física local e a velocidade da Caminhada Perfeita não mudam.
  if (force || stateChanged || now - (Number(state.lastPositionCheckpointAt) || 0) >= checkpointInterval) {
    void persistPosition(snapshot);
  }
}

export async function syncPositionForAction() {
  if (state.leaving || !state.online || !state.channel || !state.joined) {
    throw new Error("A sessão do personagem não está ativa.");
  }
  const snapshot = readLocalPosition();
  if (!snapshot || !snapshot.user_id) {
    throw new Error("Não foi possível ler a posição atual do personagem.");
  }

  // Envia primeiro a posição aos outros clientes e só libera o ataque após
  // o mesmo ponto ter sido confirmado no banco.
  broadcastPosition(snapshot);
  const saved = await flushPositionCheckpoint(snapshot);
  if (!saved) {
    throw new Error("Não foi possível sincronizar sua posição antes do combate. Tente novamente.");
  }
  return snapshot;
}

export function resetMovementNetwork() {
  lastBroadcastAt = 0;
  lastBroadcastState = "";
  lastBroadcastX = NaN;
  lastBroadcastY = NaN;
  sequence = 0;
  pendingCheckpoint = null;
}
