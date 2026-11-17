/* Movimento preditivo local; o servidor WebSocket confirma posições e colisões. */
import { state } from "./state.js?v=20261117-websocket-world-001";
import { sendMovementInput } from "./game-transport.js?v=20261117-websocket-world-001";

function serverTimestampValue(value) {
  const source = String(value || "").trim();
  if (!source) return NaN;
  const milliseconds = Date.parse(source);
  if (!Number.isFinite(milliseconds)) return NaN;
  const fraction = source.match(/\.(\d+)(?=(?:Z|[+-]\d{2}:?\d{2})$)/i)?.[1] || "";
  return milliseconds + Number(fraction.padEnd(6, "0").slice(3, 6) || 0) / 1000;
}
function compareServerTimestamps(a, b) {
  const left = serverTimestampValue(a), right = serverTimestampValue(b);
  if (Number.isFinite(left) && Number.isFinite(right)) return left === right ? 0 : left < right ? -1 : 1;
  const x = String(a || ""), y = String(b || "");
  if (!x) return y ? -1 : 0;
  if (!y) return 1;
  return x === y ? 0 : x < y ? -1 : 1;
}
export function applyOwnServerPosition(position, latencyMs = 0, requestInput = null) {
  const x = Number(position?.x), y = Number(position?.y);
  const timestamp = String(position?.position_updated_at || position?.positionUpdatedAt || "");
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(serverTimestampValue(timestamp))) return false;
  const previous = String(state.lastPosition?.positionUpdatedAt || "");
  if (previous && compareServerTimestamps(timestamp, previous) <= 0) return false;
  const direction = Number.isFinite(Number(position?.direction))
    ? Math.max(0, Math.min(3, Number(position.direction)))
    : (state.lastPosition?.direction ?? 2);
  state.lastPosition = { x, y, direction, positionUpdatedAt: timestamp, receivedAt: Date.now() };
  window.KTKWorldEntities?.reconcileLocalPosition?.(x, y, direction, latencyMs, requestInput);
  return true;
}
function readControlInput() {
  const data = window.KTKWorldEntities?.getLocalControls?.();
  if (!data) return null;
  return {
    inputX: Number.isFinite(Number(data.inputX)) ? Math.max(-1, Math.min(1, Math.trunc(Number(data.inputX)))) : 0,
    inputY: Number.isFinite(Number(data.inputY)) ? Math.max(-1, Math.min(1, Math.trunc(Number(data.inputY)))) : 0,
    running: Boolean(data.running),
    guarding: Boolean(data.guarding),
    intentRevision: Number.isFinite(data.intentRevision) ? Math.max(0, Math.trunc(data.intentRevision)) : null
  };
}
export async function sendPosition(force = false) {
  if (state.leaving || !state.joined || !state.gameSocketConnected) return false;
  const input = readControlInput();
  if (!input) return false;
  const now = performance.now();
  const moving = input.inputX !== 0 || input.inputY !== 0;
  const running = Boolean(input.running) && moving;
  const guarding = Boolean(input.guarding);
  const signature = JSON.stringify({ inputX: input.inputX, inputY: input.inputY, running, guarding });
  const changed = signature !== state.lastInputSignature;
  if (!(changed || (moving && now - state.lastMovementSentAt >= 50) || force)) return false;
  const payload = { ...input, running, guarding };
  const sequence = sendMovementInput(payload);
  if (!sequence) return false;
  state.lastInputSignature = signature;
  state.lastMovementInput = payload;
  state.lastMovementSentAt = now;
  state.lastCheckpoint = now;
  state.lastSentMovementSequence = sequence;
  return sequence;
}
