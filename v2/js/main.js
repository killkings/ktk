import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm";
import {
  normalizeControls,
  reconcilePlayerView,
  advancePlayerView
} from "./client-rules.js";
import { renderWorld } from "./world-renderer.js?v=v2-004";
import { LPCRenderer } from "./lpc-renderer.js";

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
  gender: $("#gender"),
  hair: $("#hair-color"),
  hairstyle: $("#hairstyle"),
  clothing: $("#clothing-color"),
  join: $("#join-button"),
  joinError: $("#join-error"),
  leave: $("#leave-button"),
  canvas: $("#world"),
  preview: $("#character-preview"),
  hudName: $("#hud-name"),
  connection: $("#connection-state"),
  position: $("#hud-position"),
  players: $("#hud-players"),
  gameError: $("#game-error"),
  health: $("#hud-health"),
  stamina: $("#hud-stamina"),
  satiety: $("#hud-satiety"),
  hydration: $("#hud-hydration"),
  clanChoice: $("#clan-choice"),
  clanChoose: $("#clan-choose"),
  clanStatus: $("#clan-status"),
  slots: [$("#inventory-slot-0"), $("#inventory-slot-1")],
  itemUse: $("#item-use"),
  itemEquip: $("#item-equip"),
  itemDrop: $("#item-drop"),
  wearables: Array.from(document.querySelectorAll(".wearable-slot")),
  interact: $("#interact-button"),
  attack: $("#attack-button")
};

const lpcRenderer = new LPCRenderer();

const state = {
  joined: false,
  entryAttempted: false,
  leaving: false,
  busy: false,
  movementController: null,
  claimBusy: false,
  actionBusy: false,
  rightMouseHeld: false,
  userId: "",
  accessToken: "",
  channel: null,
  localInput: normalizeControls(),
  lastInputSignature: "",
  lastAttemptSignature: "",
  nextMovementRetryAt: 0,
  lastStepAt: 0,
  lastFrameAt: 0,
  players: new Map(),
  entities: new Map(),
  entityRevisions: new Map(),
  worldSeed: 20261117,
  kingUserId: null,
  keys: new Set(),
  animationFrame: 0,
  previewFrame: 0,
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
  if (active) stopCreatorPreview();
  else startCreatorPreview();
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
    guarding: state.rightMouseHeld
  });
}

function upsertPlayer(row) {
  if (!row || typeof row !== "object" || !row.user_id) return;
  const id = String(row.user_id);
  const previous = state.players.get(id) || null;
  const incomingRevision = Number(row.revision);
  if (row.is_alive === false) {
    // Death is a newer server revision too; a delayed death packet must not
    // erase a character that the world has already advanced past it.
    if (previous && Number.isSafeInteger(incomingRevision) &&
        incomingRevision <= previous.revision) return;
    if (!previous) return;
    state.players.delete(id);
    lpcRenderer.remove(id);
    updateHud();
    if (id === state.userId && state.joined && !state.leaving) {
      void handleServerDeath();
    }
    return;
  }
  const next = reconcilePlayerView(previous, row);
  if (next) state.players.set(id, next);
  updateHud();
}

function itemLabel(item) {
  if (!item || item === "null") return "Vazio";
  const name = String(item.displayName || item.display_name || item.item_id || "Item");
  const quantity = Math.max(1, Number(item.quantity) || 1);
  return quantity > 1 ? name + " ×" + quantity : name;
}

function renderCharacterPanel(local) {
  const stats = local?.state || {};
  const value = (key, fallback) => {
    const n = Number(stats[key]);
    return Number.isFinite(n) ? n : fallback;
  };
  ui.health.textContent = Math.round(value("health", 100)) + "/" + Math.round(value("max_health", 100));
  ui.stamina.textContent = Math.round(value("stamina", 100)) + "/" + Math.round(value("max_stamina", 100));
  ui.satiety.textContent = Math.round(value("satiety", 99)) + "/99";
  ui.hydration.textContent = Math.round(value("hydration", 99)) + "/99";

  const inventory = Array.isArray(stats.inventory) ? stats.inventory : [null, null];
  const selectedSlot = Math.max(0, Math.min(1, Number(stats.selected_slot) || 0));
  ui.slots.forEach((button, index) => {
    button.textContent = (index + 1) + " · " + itemLabel(inventory[index]);
    button.classList.toggle("selected", selectedSlot === index);
    button.disabled = !state.joined || state.actionBusy;
  });
  const selectedItem = inventory[selectedSlot];
  ui.itemUse.disabled = !state.joined || state.actionBusy || !selectedItem || !["food", "drink"].includes(String(selectedItem.itemType || selectedItem.item_type || ""));
  ui.itemEquip.disabled = !state.joined || state.actionBusy || !selectedItem || !selectedItem.wearSlot && !selectedItem.wear_slot;
  ui.itemDrop.disabled = !state.joined || state.actionBusy || !selectedItem;

  const wearables = stats.wearables && typeof stats.wearables === "object" ? stats.wearables : {};
  const names = {head:"Cabeça",chest:"Peito",waist:"Cintura",legs:"Pernas",feet:"Pés"};
  ui.wearables.forEach(button => {
    const slot = button.dataset.wearSlot;
    const item = wearables[slot];
    button.textContent = names[slot] + " · " + itemLabel(item);
    button.disabled = !state.joined || state.actionBusy || !item || item === "null";
  });

  const clanColor = String(local?.clanColor || "");
  ui.clanChoice.value = clanColor || "";
  ui.clanChoice.disabled = Boolean(clanColor) || !state.joined || state.actionBusy;
  ui.clanChoose.disabled = Boolean(clanColor) || !state.joined || state.actionBusy || !ui.clanChoice.value;
  ui.clanStatus.textContent = clanColor ? "Clã definido" : "Escolha uma cor";
  ui.clanStatus.style.color = clanColor || "";
}

function updateHud() {
  const local = state.players.get(state.userId);
  if (local) {
    ui.hudName.textContent = local.displayName;
    ui.position.textContent = Math.round(local.x) + ", " + Math.round(local.y);
    renderCharacterPanel(local);
  }
  const count = state.players.size;
  ui.players.textContent = count + (count === 1 ? " jogador" : " jogadores");
  if (state.kingUserId) {
    const king = state.players.get(state.kingUserId);
    ui.connection.textContent = "♛ Rei: " + (king?.displayName || "ativo");
  } else if (state.joined) {
    ui.connection.textContent = "● Mundo sincronizado";
  }
}

function extractRow(payload) {
  return payload?.record || payload?.new || payload?.row || payload;
}

function applyRealtimePlayer(payload) {
  const row = extractRow(payload);
  if (row?.user_id) upsertPlayer(row);
}

function upsertEntity(row, deleted = false) {
  if (!row?.entity_id) return;
  const id = String(row.entity_id);
  const revision = Number(row.revision);
  if (!Number.isSafeInteger(revision) || revision < 1) return;
  const knownRevision = state.entityRevisions.get(id) ?? -1;
  if (deleted) {
    if (revision < knownRevision) return;
    state.entities.delete(id);
    state.entityRevisions.set(id, revision);
    return;
  }
  if (revision <= knownRevision) return;
  if (!Number.isFinite(Number(row.x)) || !Number.isFinite(Number(row.y))) return;
  state.entities.set(id, row);
  state.entityRevisions.set(id, revision);
}

function applyWorldRow(row) {
  if (!row || row.id !== WORLD_ID) return;
  const nextRevision = Number(row.revision) || 0;
  if (nextRevision < (state.worldRevision || 0)) return;
  state.worldRevision = nextRevision;
  state.kingUserId = row.king_user_id || null;
  state.worldSeed = Number(row.world_seed) || 20261117;
  updateHud();
}

async function claimCrown() {
  if (!state.joined || state.leaving || state.claimBusy) return;
  state.claimBusy = true;
  try {
    const { data, error } = await supabase.rpc("ktk_v2_claim_crown");
    if (error) throw error;
    if (data?.world) applyWorldRow(data.world);
    if (data?.crown) upsertEntity(data.crown);
    await loadWorldSnapshot();
    showError("A coroa foi reivindicada. O mundo já reconhece você como rei.");
  } catch (error) {
    showError(error?.message || "Não foi possível reivindicar a coroa.");
  } finally {
    state.claimBusy = false;
  }
}

async function runGameAction(rpcName, args = {}) {
  if (!state.joined || state.leaving || state.actionBusy) return null;
  state.actionBusy = true;
  updateHud();
  try {
    const { data, error } = await supabase.rpc(rpcName, args);
    if (error) throw error;
    if (data?.user_id) upsertPlayer(data);
    if (data?.player) upsertPlayer(data.player);
    if (data?.attacker) upsertPlayer(data.attacker);
    if (data?.target_type === "player" && data?.target) upsertPlayer(data.target);
    if (data?.target_type === "enemy" && data?.target) upsertEntity(data.target);
    if (data?.world) applyWorldRow(data.world);
    if (data?.crown) upsertEntity(data.crown);
    await loadWorldSnapshot();
    return data;
  } catch (error) {
    showError(error?.message || "A ação foi recusada pelo servidor.");
    return null;
  } finally {
    state.actionBusy = false;
    updateHud();
  }
}

async function chooseClan() {
  const color = String(ui.clanChoice.value || "");
  if (!color) return;
  const player = await runGameAction("ktk_v2_choose_clan", { p_color: color });
  if (player) showError("Seu clã foi definido.");
}

async function runItemAction(action, payload = {}) {
  const result = await runGameAction("ktk_v2_item_action", {
    p_action: action,
    p_payload: payload
  });
  if (result?.ok) showError("Ação confirmada pelo servidor.");
}

async function interactWithWorld() {
  const result = await runGameAction("ktk_v2_interact");
  if (result?.ok) showError("Interação confirmada pelo servidor.");
  else if (result?.reason === "NOTHING_NEARBY") showError("Não há nada próximo para interagir.");
}

async function attackTarget() {
  const result = await runGameAction("ktk_v2_attack");
  if (result?.hit) showError("Ataque confirmado · " + result.damage + " de dano.");
  else if (result?.reason === "NO_TARGET") showError("Nenhum alvo à frente.");
}

async function subscribeWorld() {
  await supabase.realtime.setAuth();
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
    })
    .on("broadcast", { event: "ENTITY_INSERT" }, ({ payload }) => upsertEntity(extractRow(payload)))
    .on("broadcast", { event: "ENTITY_UPDATE" }, ({ payload }) => upsertEntity(extractRow(payload)))
    .on("broadcast", { event: "ENTITY_DELETE" }, ({ payload }) =>
      upsertEntity(payload?.old_record || payload?.old || extractRow(payload), true))
    .on("broadcast", { event: "WORLD_UPDATE" }, ({ payload }) =>
      applyWorldRow(extractRow(payload)));

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

}

async function loadWorldSnapshot() {
  const { data, error } = await supabase.rpc("ktk_v2_world_state");
  if (error) throw error;
  if (!state.joined || state.leaving) return;
  applyWorldRow(data?.world);
  const players = Array.isArray(data?.players) ? data.players : [];
  players.forEach(upsertPlayer);
  const entities = Array.isArray(data?.entities) ? data.entities : [];
  entities.forEach(row => upsertEntity(row));
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

  // Create the private Realtime subscription before any INSERT/UPDATE trigger
  // can broadcast from Postgres. This also supplies the JWT for channel RLS.
  await subscribeWorld();

  state.entryAttempted = true;
  const { data: player, error: enterError } = await supabase.rpc("ktk_v2_enter_world", {
    p_display_name: displayName,
    p_appearance: appearance
  });
  if (enterError) throw new Error("Não foi possível criar o personagem no servidor: " + enterError.message);
  if (!player?.user_id) throw new Error("O servidor não confirmou a criação do personagem.");

  state.joined = true;
  state.leaving = false;
  upsertPlayer(player);
  const { error: presenceError } = await state.channel.track({
    user_id: state.userId,
    joined_at: new Date().toISOString()
  });
  if (presenceError) console.warn("KTK V2 presence:", presenceError.message);
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
  if (signature === state.lastAttemptSignature && now < state.nextMovementRetryAt) return;

  state.localInput = controls;
  state.lastAttemptSignature = signature;
  state.busy = true;
  const movementController = new AbortController();
  state.movementController = movementController;
  const movementTimeout = setTimeout(() => movementController.abort(), 1500);
  try {
    const { data, error } = await supabase.rpc("ktk_v2_step_player", {
      p_input_x: controls.x,
      p_input_y: controls.y,
      p_running: controls.running,
      p_guarding: controls.guarding
    }).abortSignal(movementController.signal);
    if (error) throw error;
    if (!state.joined || state.leaving) return;
    upsertPlayer(data?.player || data);
    state.lastInputSignature = signature;
    state.nextMovementRetryAt = 0;
    state.lastStepAt = performance.now();
    showError("");
  } catch (error) {
    state.nextMovementRetryAt = performance.now() + 500;
    const message = error?.message || "Falha ao sincronizar o movimento.";
    if (!message.includes("PLAYER_NOT_ACTIVE")) showError(message);
  } finally {
    clearTimeout(movementTimeout);
    if (state.movementController === movementController) state.movementController = null;
    state.busy = false;
    if (state.joined && !state.leaving) {
      const latest = controlSignature(readControls());
      if (latest !== signature) void pumpMovement();
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
  renderWorld(
    ui.canvas, views, state.userId, dt,
    [...state.entities.values()], state.worldSeed, state.kingUserId, lpcRenderer
  );
  const local = state.players.get(state.userId);
  if (local) ui.position.textContent = Math.round(local.x) + ", " + Math.round(local.y);
  state.animationFrame = requestAnimationFrame(frame);
}

async function cleanupLocalSession() {
  state.movementController?.abort();
  state.movementController = null;
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
  state.entryAttempted = false;
  state.lastAttemptSignature = "";
  state.nextMovementRetryAt = 0;
  state.players.clear();
  lpcRenderer.clear();
  state.entities.clear();
  state.entityRevisions.clear();
  state.kingUserId = null;
  state.worldRevision = 0;
  state.keys.clear();
  state.localInput = normalizeControls();
  state.rightMouseHeld = false;
  state.lastInputSignature = "";
  state.lastAttemptSignature = "";
  state.nextMovementRetryAt = 0;
  state.busy = false;
  state.joined = false;
  state.leaving = false;
  clearInterval(state.movementTimer);
  state.movementTimer = 0;
  cancelAnimationFrame(state.animationFrame);
  state.animationFrame = 0;
  renderCharacterPanel(null);
}

async function leaveWorld(fromPageHide = false) {
  if (!state.joined || state.leaving) return;
  state.leaving = true;
  state.movementController?.abort();
  state.movementController = null;
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
    await enterWorld(displayName, creatorAppearance());
  } catch (error) {
    if (state.entryAttempted && state.userId) {
      try {
        await supabase.rpc("ktk_v2_leave_world");
      } catch (leaveError) {
        console.error("KTK V2 rollback after failed entry:", leaveError);
      }
    }
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
  if (event.target?.matches?.("input,select,textarea")) return;
  if (state.joined && keyIsCrown(event)) {
    event.preventDefault();
    void interactWithWorld();
    return;
  }
  if (state.joined && (event.code === "Space" || event.key === " ")) {
    event.preventDefault();
    void attackTarget();
    return;
  }
  const key = event.key.toLowerCase();
  if (state.joined && (key === "1" || key === "2")) {
    event.preventDefault();
    void runItemAction("select_slot", { slot: Number(key) - 1 });
    return;
  }
  if (["w","a","s","d","arrowup","arrowdown","arrowleft","arrowright","shift"].includes(key)) {
    event.preventDefault();
    state.keys.add(key);
  }
});
window.addEventListener("keyup", event => state.keys.delete(event.key.toLowerCase()));
window.addEventListener("blur", () => {
  state.keys.clear();
  state.rightMouseHeld = false;
});
ui.slots[0].addEventListener("click", () => void runItemAction("select_slot",{slot:0}));
ui.slots[1].addEventListener("click", () => void runItemAction("select_slot",{slot:1}));
ui.itemUse.addEventListener("click", () => {
  const local = state.players.get(state.userId);
  const slot = Math.max(0,Math.min(1,Number(local?.state?.selected_slot)||0));
  void runItemAction("consume",{slot});
});
ui.itemEquip.addEventListener("click", () => {
  const local = state.players.get(state.userId);
  const slot = Math.max(0,Math.min(1,Number(local?.state?.selected_slot)||0));
  void runItemAction("equip",{slot});
});
ui.itemDrop.addEventListener("click", () => {
  const local = state.players.get(state.userId);
  const slot = Math.max(0,Math.min(1,Number(local?.state?.selected_slot)||0));
  void runItemAction("drop",{slot});
});
ui.wearables.forEach(button => button.addEventListener("click", () => {
  void runItemAction("unequip",{wear_slot:button.dataset.wearSlot});
}));
ui.clanChoose.addEventListener("click", () => void chooseClan());
ui.interact.addEventListener("click", () => void interactWithWorld());
ui.attack.addEventListener("click", () => void attackTarget());
ui.canvas.addEventListener("pointerdown", event => {
  if (event.button === 2) {
    state.rightMouseHeld = true;
    event.preventDefault();
  }
});
window.addEventListener("pointerup", event => {
  if (event.button === 2) state.rightMouseHeld = false;
});
ui.canvas.addEventListener("contextmenu", event => event.preventDefault());
window.addEventListener("pagehide", event => {
  // A back-forward-cache suspension is not an explicit exit from the world.
  if (!event.persisted) void leaveWorld(true);
});
window.addEventListener("resize", () => {
  if (state.joined) renderWorld(
    ui.canvas, [...state.players.values()], state.userId, 0,
    [...state.entities.values()], state.worldSeed, state.kingUserId, lpcRenderer
  );
});

function creatorAppearance() {
  return {
    gender: ui.gender.value,
    skin: ui.skin.value,
    eyes: "brown",
    hair: ui.hair.value,
    hairstyle: ui.hairstyle.value,
    beard: "none",
    mustache: "none",
    clothing: ui.clothing.value
  };
}

function stopCreatorPreview() {
  if (state.previewFrame) cancelAnimationFrame(state.previewFrame);
  state.previewFrame = 0;
}

function startCreatorPreview() {
  if (state.joined || state.previewFrame || !ui.preview) return;
  const draw = () => {
    if (state.joined || !ui.preview) {
      state.previewFrame = 0;
      return;
    }
    const context = ui.preview.getContext("2d");
    if (context) {
      context.clearRect(0,0,ui.preview.width,ui.preview.height);
      const previewPlayer = {
        userId: "__ktk_v2_creator_preview__",
        appearance: creatorAppearance(),
        direction: 2,
        moving: false,
        running: false,
        state: { moving:false, running:false, wearables:{} }
      };
      lpcRenderer.draw(context,previewPlayer,ui.preview.width/2,ui.preview.height/2,1/60);
    }
    state.previewFrame = requestAnimationFrame(draw);
  };
  state.previewFrame = requestAnimationFrame(draw);
}

function refreshHairstyleOptions() {
  if (!ui.hairstyle) return;
  const gender = ui.gender?.value || "male";
  const current = ui.hairstyle.value;
  const styles = (window.KTKHairStyles || [])
    .filter(style => !Array.isArray(style.availableFor) || style.availableFor.includes(gender));
  ui.hairstyle.replaceChildren();
  styles.forEach(style => {
    const option = document.createElement("option");
    option.value = style.id;
    option.textContent = style.name;
    ui.hairstyle.append(option);
  });
  const preferred = styles.find(style => style.id === current)
    || styles.find(style => style.id === "hair_pixie")
    || styles[0];
  if (preferred) ui.hairstyle.value = preferred.id;
}

async function handleServerDeath() {
  if (state.leaving || !state.joined) return;
  state.leaving = true;
  await cleanupLocalSession();
  showGame(false);
  ui.name.value = "";
  ui.connection.textContent = "Personagem morto";
  showError("Seu personagem morreu. Crie outro para voltar ao mundo.", "join");
}

ui.gender.addEventListener("change", refreshHairstyleOptions);
refreshHairstyleOptions();
[ui.gender,ui.skin,ui.hair,ui.hairstyle,ui.clothing].forEach(control=>{
  control.addEventListener("change",()=>{
    if(!state.joined) {
      stopCreatorPreview();
      startCreatorPreview();
    }
  });
});
startCreatorPreview();

function keyIsCrown(event) {
  return event.key.toLowerCase() === "e";
}

showGame(false);
