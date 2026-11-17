// Client rules only: sanitize controls and animate server snapshots.
// This module never decides world position, collision, damage, inventory or ownership.
export function normalizeControls(input = {}) {
  const axis = value => {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(-1, Math.min(1, Math.trunc(number)));
  };
  const x = axis(input.x);
  const y = axis(input.y);
  const moving = x !== 0 || y !== 0;
  return {
    x,
    y,
    running: Boolean(input.running) && moving,
    guarding: Boolean(input.guarding)
  };
}

export function isNewerRevision(incoming, current) {
  const next = Number(incoming);
  const previous = Number(current);
  return Number.isSafeInteger(next) && next >= 0 &&
    (!Number.isSafeInteger(previous) || next > previous);
}

export function createPlayerView(row, previous = null) {
  if (!row || typeof row !== "object") return null;
  const x = Number(row.x);
  const y = Number(row.y);
  const revision = Number(row.revision);
  if (!Number.isFinite(x) || !Number.isFinite(y) ||
      !Number.isSafeInteger(revision) || revision < 0) return null;
  return {
    userId: String(row.user_id || ""),
    displayName: String(row.display_name || "Aventureiro").slice(0, 24),
    appearance: row.appearance && typeof row.appearance === "object" ? row.appearance : {},
    clanColor: String(row.clan_color || ""),
    x,
    y,
    targetX: x,
    targetY: y,
    direction: Math.max(0, Math.min(3, Number(row.direction) || 0)),
    revision,
    visualX: previous && Number.isFinite(previous.visualX) ? previous.visualX : x,
    visualY: previous && Number.isFinite(previous.visualY) ? previous.visualY : y,
    moving: Boolean(row.state?.moving),
    running: Boolean(row.state?.running),
    state: row.state && typeof row.state === "object" ? row.state : {}
  };
}

export function reconcilePlayerView(current, row) {
  if (!row || row.is_alive === false) return null;
  if (!current) return createPlayerView(row);
  if (!isNewerRevision(row.revision, current.revision)) return current;
  const next = createPlayerView(row, current);
  if (!next) return current;
  // Only targets are replaced; visual coordinates are presentation-only.
  next.visualX = current.visualX;
  next.visualY = current.visualY;
  return next;
}

export function advancePlayerView(view, deltaSeconds, maxVisualSpeed = 520) {
  if (!view) return null;
  const dt = Math.max(0, Math.min(0.05, Number(deltaSeconds) || 0));
  const blend = 1 - Math.exp(-dt * 20);
  const maxStep = Math.max(0, maxVisualSpeed) * dt;
  const move = (current, target) => {
    const difference = target - current;
    const step = Math.sign(difference) * Math.min(Math.abs(difference * blend), maxStep);
    return Math.abs(difference - step) < 0.15 ? target : current + step;
  };
  return {
    ...view,
    visualX: move(view.visualX, view.targetX),
    visualY: move(view.visualY, view.targetY)
  };
}
