import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm";
import {
  normalizeControls,
  reconcilePlayerView,
  advancePlayerView
} from "./client-rules.js";
import { renderWorld } from "./world-renderer.js";

const SUPABASE_URL = "https://mtddtvqtljtgzggpdogl.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_U5CdIRdPg0Brfn7x2Bj2hQ_VCXjwRQH";
const WORLD_ID = "main";
const TOPIC = "v2:world:main";
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: true,
    detectSessionInUrl: false
  },
  realtime: { params: { eventsPerSecond: 20 } }
});

const $ = selector => document.querySelector(selector);
const ui = {
  welcome: $("#welcome"),
  game: $("#game"),
  form: $("#join-form"),
  name: $("#display-name"),
  skin: $("#skin-color"),
  clothing: $("#clothing-color"),
  join: $("#join-button"),
  joinError: $("#join-error"),
  leave: $("#leave-button"),
  canvas: $("#world"),
  hudName: $("#hud-name"),
  connection: $("#connection-state"),
  position: $("#hud-position"),
  players: $("#hud-players"),
  gameError: $("#game-error")
};

const state = {
  joined: false,
  leaving: false,
  busy: false,
  userId: "",
  accessToken: "",
  channel: null,
  localInput: normalizeControls(),
  lastInputSignature: "",
  lastStepAt: 0,
  lastFrameAt: 0,
  players: new Map(),
  keys: new Set(),
  animationFrame: 0,
  movementTimer: 0,
  errorTimer: 0
};

function showError(message, target = "game") {
  if (target === "join") {
    ui.joinError.textContent = message || "";
    return;
  }
  ui.gameError.textContent = message || "";
  ui.gameError.classList.toggle("show", Boolean(message));
  clearTimeout(state.errorTimer);
  if (message) {
    state.errorTimer = setTimeout(() => ui.gameError.classList.remove("show"), 4500);
  }
}

function showGame(active) {
  ui.welcome.classList.toggle("screen-active", !active);
  ui.game.classList.toggle("active", active);
  if (!active) ui.game.classList.remove("active");
}

function controlSignature(controls) {
  return JSON.stringify(controls);
}

function readControls() {
  const left = state.keys.has("a") || state.keys.has("arrowleft");
  const right = state.keys.has("d") || state.keys.has("arrowright");
  const up = state.keys.has("w") || state.keys.has("arrowup");
  const down = state.keys.has("s") || state.keys.has("arrowdown");
  return normalizeControls({
    x: Number(right) - Number(left),
    y: Number(down) - Number(up),
    running: state.keys.has("shift"),
    guarding: false
  });
}

function upsertPlayer(row) {
  if (!row || typeof row !== "object" || !row.user_id) return;
  const id = String(row.user_id);
  if (row.is_alive === false) {
    state.players.delete(id);
    updateHud();
    return;
  }
  const previous = state.players.get(id) || null;
  const next = reconcilePlayerView(previous, row);
  if (next) state.players.set(id, next);
  updateHud();
}

function updateHud() {
  const local = state.players.get(state.userId);
  if (local) {
    ui.hudName.textContent = local.displayName;
    ui.position.textContent = Math.round(local.x) + ", " + Math.round(local.y);
  }
  const count = state.players.size;
  ui.players.textContent = count + (count === 1 ? " jogador" : " jogadores");
}

function extractRow(payload) {
  return payload?.record || payload?.new || payload?.row || payload;
}

function applyRealtimePlayer(payload) {
  const row = extractRow(payload);
  if (row?.user_id) upsertPlayer(row);
}

async function subscribeWorld() {
  const channel = supabase.channel(TOPIC, {
    config: {
      private: true,
      broadcast: { self: false, ack: false },
      presence: { key: state.userId }
    }
  });
  channel
    .on("broadcast", { event: "INSERT" }, ({ payload }) => applyRealtimePlayer(payload))
    .on("broadcast", { event: "UPDATE" }, ({ payload }) => applyRealtimePlayer(payload))
    .on("broadcast", { event: "DELETE" }, ({ payload }) => {
      const row = payload?.old_record || payload?.old || extractRow(payload);
      if (row?.user_id) state.players.delete(String(row.user_id));
      updateHud();
    });

  state.channel = channel;
  await new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("Tempo esgotado ao conectar ao mundo V2."));
      }
    }, 12000);
    channel.subscribe(status => {
      if (status === "SUBSCRIBED" && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve();
      } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status) && !settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error("Conexão Realtime indisponível: " + status));
      }
      if (status === "SUBSCRIBED") ui.connection.textContent = "● Mundo sincronizado";
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") ui.connection.textContent = "Conexão instável";
    });
  });

  const { error } = await state.channel.track({
    user_id: state.userId,
    joined_at: new Date().toISOString()
  });
  if (error) console.warn("KTK V2 presence:", error.message);
}

async function loadWorldSnapshot() {
  const { data, error } = await supabase.rpc("ktk_v2_world_state");
  if (error) throw error;
  if (!state.joined || state.leaving) return;
  const players = Array.isArray(data?.players) ? data.players : [];
  players.forEach(upsertPlayer);
  const ownPlayer = state.players.get(state.userId);
  if (!ownPlayer) throw new Error("O servidor não retornou o personagem recém-criado.");
}

async function enterWorld(displayName, appearance) {
  const { data: authData, error: authError } = await supabase.auth.signInAnonymously();
  if (authError) throw new Error("Não foi possível iniciar uma sessão nova: " + authError.message);
  if (!authData?.user?.id || !authData?.session?.access_token) {
    throw new Error("O Supabase não retornou uma identidade válida para a sessão.");
  }
  state.userId = authData.user.id;
  state.accessToken = authData.session.access_token;

  const { data: player, error: enterError } = await supabase.rpc("ktk_v2_enter_world", {
    p_display_name: displayName,
    p_appearance: appearance
  });
  if (enterError) throw new Error("Não foi possível criar o personagem no servidor: " + enterError.message);
  if (!player?.user_id) throw new Error("O servidor não confirmou a criação do personagem.");

  state.joined = true;
  state.leaving = false;
  state.players.clear();
  upsertPlayer(player);
  await subscribeWorld();
  await loadWorldSnapshot();
  state.lastInputSignature = "";
  state.lastStepAt = 0;
  ui.connection.textContent = "● Mundo sincronizado";
  showGame(true);
  state.movementTimer = window.setInterval(pumpMovement, 100);
  state.lastFrameAt = performance.now();
  state.animationFrame = requestAnimationFrame(frame);
}

async function pumpMovement() {
  if (!state.joined || state.leaving || state.busy) return;
  const controls = readControls();
  const signature = controlSignature(controls);
  const moving = controls.x !== 0 || controls.y !== 0;
  const now = performance.now();
  const changed = signature !== state.lastInputSignature;
  const heartbeatDue = now - state.lastStepAt >= 2500;
  if (!changed && !moving && !heartbeatDue) return;

  state.localInput = controls;
  state.busy = true;
  try {
    const { data, error } = await supabase.rpc("ktk_v2_step_player", {
      p_input_x: controls.x,
      p_input_y: controls.y,
      p_running: controls.running,
      p_guarding: controls.guarding
    });
    if (error) throw error;
    if (!state.joined || state.leaving) return;
    upsertPlayer(data?.player || data);
    state.lastInputSignature = signature;
    state.lastStepAt = performance.now();
    showError("");
  } catch (error) {
    state.lastInputSignature = "";
    const message = error?.message || "Falha ao sincronizar o movimento.";
    if (!message.includes("PLAYER_NOT_ACTIVE")) showError(message);
  } finally {
    state.busy = false;
    if (state.joined && !state.leaving) {
      const latest = controlSignature(readControls());
      if (latest !== state.lastInputSignature) void pumpMovement();
    }
  }
}

function frame(now) {
  if (!state.joined || state.leaving) return;
  const dt = Math.max(0, Math.min(0.05, (now - state.lastFrameAt) / 1000));
  state.lastFrameAt = now;
  const views = [];
  for (const [id, player] of state.players) {
    const advanced = advancePlayerView(player, dt);
    state.players.set(id, advanced);
    views.push(advanced);
  }
  renderWorld(ui.canvas, views, state.userId, dt);
  const local = state.players.get(state.userId);
  if (local) ui.position.textContent = Math.round(local.x) + ", " + Math.round(local.y);
  state.animationFrame = requestAnimationFrame(frame);
}

async function cleanupLocalSession() {
  if (state.channel) {
    const channel = state.channel;
    state.channel = null;
    try { await supabase.removeChannel(channel); } catch (error) {
      console.warn("KTK V2 channel cleanup:", error?.message || error);
    }
  }
  try { await supabase.auth.signOut({ scope: "local" }); } catch (error) {
    console.warn("KTK V2 local sign-out:", error?.message || error);
  }
  state.userId = "";
  state.accessToken = "";
  state.players.clear();
  state.keys.clear();
  state.localInput = normalizeControls();
  state.lastInputSignature = "";
  state.busy = false;
  state.joined = false;
  state.leaving = false;
  clearInterval(state.movementTimer);
  state.movementTimer = 0;
  cancelAnimationFrame(state.animationFrame);
  state.animationFrame = 0;
}

async function leaveWorld(fromPageHide = false) {
  if (!state.joined || state.leaving) return;
  state.leaving = true;
  state.keys.clear();
  clearInterval(state.movementTimer);
  state.movementTimer = 0;
  cancelAnimationFrame(state.animationFrame);
  state.animationFrame = 0;

  if (fromPageHide && state.accessToken) {
    const token = state.accessToken;
    void fetch(SUPABASE_URL + "/rest/v1/rpc/ktk_v2_leave_world", {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      keepalive: true,
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: "{}"
    }).catch(error => console.warn("KTK V2 page exit:", error));
    state.joined = false;
    void cleanupLocalSession();
    return;
  }

  try {
    const { data, error } = await supabase.rpc("ktk_v2_leave_world");
    if (error) throw error;
    if (data?.ok === false) throw new Error("O servidor não confirmou a saída.");
    await cleanupLocalSession();
    showGame(false);
    ui.name.value = "";
    ui.connection.textContent = "Personagem encerrado";
    ui.joinError.textContent = "";
  } catch (error) {
    state.leaving = false;
    showError("Não foi possível encerrar no servidor: " + (error?.message || error));
  }
}

ui.form.addEventListener("submit", async event => {
  event.preventDefault();
  showError("", "join");
  const displayName = String(ui.name.value || "").trim().slice(0, 24);
  if (displayName.length < 2) {
    showError("Use um nome com pelo menos 2 caracteres.", "join");
    return;
  }
  ui.join.disabled = true;
  ui.join.textContent = "Conectando…";
  try {
    await enterWorld(displayName, {
      skin: ui.skin.value,
      clothing: ui.clothing.value,
      hair: "none",
      hairColor: "#38251c"
    });
  } catch (error) {
    await cleanupLocalSession();
    showError(error?.message || "Não foi possível entrar no mundo.", "join");
    showGame(false);
  } finally {
    ui.join.disabled = false;
    ui.join.textContent = "Entrar no mundo";
  }
});

ui.leave.addEventListener("click", () => void leaveWorld(false));

window.addEventListener("keydown", event => {
  if (state.joined && event.key === "Escape") {
    event.preventDefault();
    void leaveWorld(false);
    return;
  }
  const key = event.key.toLowerCase();
  if (["w","a","s","d","arrowup","arrowdown","arrowleft","arrowright","shift"].includes(key)) {
    event.preventDefault();
    state.keys.add(key);
  }
});
window.addEventListener("keyup", event => state.keys.delete(event.key.toLowerCase()));
window.addEventListener("blur", () => state.keys.clear());
window.addEventListener("pagehide", () => void leaveWorld(true));
window.addEventListener("resize", () => {
  if (state.joined) renderWorld(ui.canvas, [...state.players.values()], state.userId, 0);
});

showGame(false);
