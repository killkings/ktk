/* Movimento: o cliente envia intenções e só aplica coordenadas oficiais do servidor. */
import { state } from "./state.js?v=20261117-remote-snapshot-007";
import { supabase } from "./supabase-client.js?v=20261117-remote-snapshot-007";

state.lastMovementLatencyMs = Math.max(
  0, Math.min(750, Number(state.lastMovementLatencyMs) || 150)
);

function readControlInput() {
  const data = window.KTKWorldEntities?.getLocalControls?.();
  if (!data) return null;
  return {
    inputX: Number.isFinite(Number(data.inputX)) ? Math.max(-1, Math.min(1, Math.trunc(Number(data.inputX)))) : 0,
    inputY: Number.isFinite(Number(data.inputY)) ? Math.max(-1, Math.min(1, Math.trunc(Number(data.inputY)))) : 0,
    running: Boolean(data.running),
    guarding: Boolean(data.guarding),
    inputAgeMs: Math.max(0, Math.min(750, Math.trunc(Number(data.inputAgeMs) || 0))),
    intentRevision: Number.isFinite(data.intentRevision) ? Math.max(0,Math.trunc(data.intentRevision)) : null
  };
}

// PostgreSQL timestamptz values have microsecond precision. Date.parse()
// truncates them to milliseconds, which is not enough to order rapid updates.

function serverTimestampValue(value) {
  const source = String(value || "").trim();
  if (!source) return NaN;
  const milliseconds = Date.parse(source);
  if (!Number.isFinite(milliseconds)) return NaN;
  const fraction = source.match(/\.(\d+)(?=(?:Z|[+-]\d{2}:?\d{2})$)/i)?.[1] || "";
  const subMillisecond = Number(fraction.padEnd(6, "0").slice(3, 6) || 0) / 1000;
  return milliseconds + subMillisecond;
}

function compareServerTimestamps(a, b) {
  const left = serverTimestampValue(a);
  const right = serverTimestampValue(b);
  if (Number.isFinite(left) && Number.isFinite(right)) {
    return left === right ? 0 : (left < right ? -1 : 1);
  }
  const leftText = String(a || "");
  const rightText = String(b || "");
  if (!leftText) return rightText ? -1 : 0;
  if (!rightText) return 1;
  return leftText === rightText ? 0 : (leftText < rightText ? -1 : 1);
}

export function applyOwnServerPosition(position, latencyMs = 0, requestInput = null, intentTimeline = null) {
  const x = Number(position?.x);
  const y = Number(position?.y);
  const positionUpdatedAt = String(position?.position_updated_at || position?.positionUpdatedAt || "");
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(serverTimestampValue(positionUpdatedAt))) {
    return false;
  }

  const previousTimestamp = String(state.lastPosition?.positionUpdatedAt || "");
  if (previousTimestamp && compareServerTimestamps(positionUpdatedAt, previousTimestamp) <= 0) {
    return false;
  }

  const direction = Number.isFinite(Number(position?.direction))
    ? Math.max(0, Math.min(3, Number(position.direction)))
    : (state.lastPosition?.direction ?? 2);

  state.lastPosition = {
    x,
    y,
    direction,
    positionUpdatedAt,
    receivedAt: Date.now()
  };
  window.KTKWorldEntities?.reconcileLocalPosition?.(x, y, direction, latencyMs, requestInput, intentTimeline);
  return true;
}

export async function sendPosition(force = false) {
  if (state.leaving || !state.online || !state.channel || !state.joined) return;
  const payload = readControlInput();
  if (!payload) return;

  const now = Date.now();
  const inputX = Math.max(-1, Math.min(1, Math.trunc(Number(payload.inputX) || 0)));
  const inputY = Math.max(-1, Math.min(1, Math.trunc(Number(payload.inputY) || 0)));
  const moving = inputX !== 0 || inputY !== 0;
  const running = Boolean(payload.running) && moving;
  const guarding = Boolean(payload.guarding);
  const inputSignature = JSON.stringify({ inputX, inputY, running, guarding });
  const inputChanged = inputSignature !== state.lastInputSignature;
  const requestInput = { inputX, inputY, running, guarding, intentRevision: payload.intentRevision };
  const inputAgeAtServer = Math.max(0, Math.min(
    750,
    Math.round(payload.inputAgeMs + (Number(state.lastMovementLatencyMs) || 150) / 2)
  ));

  // O navegador envia controles e a idade aproximada da intenção; posição,
  // velocidade de equipamento e colisões permanecem autoritativas no SQL.
  const shouldStep = inputChanged || (moving && now - state.lastCheckpoint >= 90) || force;
  if (!shouldStep || state.stepInFlight) return;
  if (state.leaving || !state.online || !state.joined) return;

  state.stepInFlight = true;
  state.lastCheckpoint = now;
  const stepId = ++state.stepSequence;
  state.activeStepId = stepId;
  const stepController = new AbortController();
  state.stepController = stepController;
  const stepTimeout = setTimeout(() => stepController.abort(), 900);

  let stepAccepted = false;
  try {
    const requestStartedAt = Date.now();
    const requestStartedPerformanceAt = performance.now();
    const { data: step, error } = await supabase.rpc("ktk_step_player", {
      p_input_x: inputX,
      p_input_y: inputY,
      p_running: running,
      p_guarding: guarding,
      p_input_age_ms: inputAgeAtServer
    }).abortSignal(stepController.signal);

    if (stepId !== state.stepSequence) return;
    const requestLatencyMs = Date.now() - requestStartedAt;
    state.lastMovementLatencyMs = Math.max(0, Math.min(
      750,
      (Number(state.lastMovementLatencyMs) || 150) * 0.75 + requestLatencyMs * 0.25
    ));
    if (error) {
      state.lastInputSignature = "";
      console.warn("KTK server movement:", error.message);
      return;
    }
    if (state.leaving || !state.online || !state.joined) return;

    state.lastInputSignature = inputSignature;
    stepAccepted = Boolean(step && step.accepted !== false);
    if (step && Number.isFinite(Number(step.x)) && Number.isFinite(Number(step.y))) {
      // O próprio RPC já devolve o estado usado pelo servidor neste passo.
      // Aplicá-lo antes da previsão evita calcular corrida com stamina antiga.
      if (step.state && typeof step.state === "object") {
        try {
          window.KTKWorldEntities?.applyServerState?.(step.state);
        } catch (stateError) {
          console.warn("KTK movement state update:", stateError?.message || stateError);
        }
      }

      const serverX = Number(step.x);
      const serverY = Number(step.y);
      const direction = Number.isFinite(Number(step.direction))
        ? Math.max(0, Math.min(3, Number(step.direction)))
        : payload.direction;
      const acceptedRequestInput = step.state && typeof step.state === "object"
        ? {
            ...requestInput,
            inputX: Number.isFinite(Number(step.state.movement_input_x))
              ? Number(step.state.movement_input_x) : requestInput.inputX,
            inputY: Number.isFinite(Number(step.state.movement_input_y))
              ? Number(step.state.movement_input_y) : requestInput.inputY,
            running: step.state.movement_running !== undefined
              ? Boolean(step.state.movement_running) : requestInput.running,
            guarding: step.state.movement_guarding !== undefined
              ? Boolean(step.state.movement_guarding) : requestInput.guarding
          }
        : requestInput;
      const estimatedServerSnapshotAt = requestStartedPerformanceAt + requestLatencyMs / 2;
      const intentTimeline = window.KTKWorldEntities?.getLocalIntentTimeline?.(
        estimatedServerSnapshotAt, acceptedRequestInput
      );
      applyOwnServerPosition({
        x: serverX,
        y: serverY,
        direction,
        position_updated_at: step.position_updated_at
      }, requestLatencyMs, acceptedRequestInput, intentTimeline);
    }
  } catch (error) {
    if (stepId === state.stepSequence) {
      state.lastInputSignature = "";
      if (error?.name === "AbortError") {
        console.warn("KTK server movement: request timed out; the next heartbeat will retry.");
      } else {
        console.warn("KTK server movement:", error?.message || error);
      }
    }
  } finally {
    clearTimeout(stepTimeout);
    if (state.stepController === stepController) state.stepController = null;
    if (state.activeStepId === stepId) {
      state.activeStepId = 0;
      state.stepInFlight = false;

      // A key change made while the request was pending is sent immediately
      // instead of waiting for the next 100 ms heartbeat.
      if (!state.leaving && state.online && state.joined) {
        const latest = readControlInput();
        if (latest) {
          const latestMoving = latest.inputX !== 0 || latest.inputY !== 0;
          const latestSignature = JSON.stringify({
            inputX: latest.inputX,
            inputY: latest.inputY,
            running: Boolean(latest.running) && latestMoving,
            guarding: Boolean(latest.guarding)
          });
          if (latestSignature !== inputSignature || (stepAccepted && latestMoving)) {
            void sendPosition(false);
          }
        }
      }
    }
  }
}
