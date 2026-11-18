import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const root = process.cwd();
const lifecycle = await readFile(new URL("../game/game-lifecycle.js", import.meta.url), "utf8");
const onlineModule = await readFile(new URL("../js/online.js", import.meta.url), "utf8");
const html = await readFile(new URL("../campo_livre_atualizado.html", import.meta.url), "utf8");

const elements = new Map();
function element(id) {
  if (!elements.has(id)) {
    const listeners = new Map();
    elements.set(id, {
      id,
      value: "",
      textContent: "",
      disabled: false,
      dataset: {},
      style: {},
      focused: false,
      listeners,
      classList: {
        add() {},
        remove() {},
        toggle() {}
      },
      addEventListener(type, callback) {
        const callbacks = listeners.get(type) || [];
        callbacks.push(callback);
        listeners.set(type, callbacks);
      },
      focus() {
        this.focused = true;
      }
    });
  }
  return elements.get(id);
}

const windowListeners = new Map();
const screenNames = ["welcome", "death", "creator", "game"];
const screenState = Object.fromEntries(screenNames.map(name => [name, false]));
const screens = Object.fromEntries(screenNames.map(name => [name, {
  classList: {
    toggle(_className, active) { screenState[name] = Boolean(active); },
    contains() { return screenState[name]; }
  }
}]));
let throwInitialStateError = false;
const runtimeErrors = [];
const window = {
  KTKOnline: null,
  addEventListener(type, callback) {
    const callbacks = windowListeners.get(type) || [];
    callbacks.push(callback);
    windowListeners.set(type, callbacks);
  },
  removeEventListener(type, callback) {
    const callbacks = windowListeners.get(type) || [];
    windowListeners.set(type, callbacks.filter(item => item !== callback));
  },
  dispatchEvent(event) {
    for (const callback of [...(windowListeners.get(event.type) || [])]) callback(event);
  }
};
const document = {
  getElementById: element,
  querySelectorAll() {
    return [];
  }
};

const context = vm.createContext({
  window,
  document,
  console: { error(...args) { runtimeErrors.push(args.map(value => String(value)).join(" ")); }, warn() {} },
  setTimeout(callback) {
    return { callback };
  },
  clearTimeout() {},
  character: {},
  newCharacterRequired: false,
  gameStarted: false,
  playerDead: false,
  toastTimer: 0,
  screens,
  showScreen(which) {
    for (const name of screenNames) screens[name].classList.toggle("active", name === which);
  },
  applyServerState() {
    assert.equal(screens.game.classList.contains("active"), true,
      "A tela do jogo deve abrir antes da hidratação visual do estado.");
    if (throwInitialStateError) throw new Error("Falha visual simulada.");
  },
  renderInventory() {},
  rebuildCharacterLayers() { return Promise.resolve(); },
  updateKingStatus() {},
  camera: {x:0,y:0},
  walkTime: 0,
  idleTime: 0,
  player: {knockback:null, knockbackHeight:0}
});

vm.runInContext(lifecycle, context, { filename: "game/game-lifecycle.js" });

const button = element("enter-world");
button.textContent = "Entrar no mundo →";
const nameInput = element("ktk-display-name");
const click = button.listeners.get("click")?.[0];
assert.equal(typeof click, "function", "O botão Entrar no mundo precisa ter um listener.");

let enterCalls = 0;
await click();
assert.equal(enterCalls, 0, "Nome inválido não deve iniciar autenticação nem entrada.");
assert.equal(nameInput.focused, true, "O campo do nome deve receber foco quando inválido.");
assert.match(element("toast").textContent, /pelo menos 2 caracteres/i);

nameInput.value = "Uriel";
let receivedOptions = null;
const pendingEntry = click();
assert.equal(button.disabled, true, "O botão deve indicar que a conexão está em andamento.");
assert.ok((windowListeners.get("ktk-online-ready") || []).length > 0,
  "O fluxo deve aguardar a inicialização do módulo online.");

window.KTKOnline = {
  async enter(options) {
    enterCalls++;
    receivedOptions = options;
    options.onProgress?.("Carregando estado do mundo...");
    return { ok: false, error: "Falha simulada da RPC." };
  }
};
window.dispatchEvent({ type: "ktk-online-ready" });
await pendingEntry;

assert.equal(enterCalls, 1, "O módulo online deve ser chamado depois de ficar pronto.");
assert.equal(receivedOptions.displayName, "Uriel");
assert.equal(button.disabled, false, "O botão deve ser reativado após uma resposta.");
assert.equal(button.textContent, "Entrar no mundo →",
  "O botão deve restaurar o rótulo após falha em uma etapa intermediária.");
assert.equal(element("toast").textContent, "Falha simulada da RPC.");
assert.equal(screens.game.classList.contains("active"), false,
  "Uma falha de conexão não deve abrir o mundo.");

throwInitialStateError = true;
window.KTKOnline = {
  async enter() {
    enterCalls++;
    return { ok: true, player: { state: { health: 100 }, x: 84, y: 96, direction: 2 } };
  }
};
await click();
assert.equal(screens.game.classList.contains("active"), true,
  "O mundo deve aparecer mesmo quando a hidratação visual falhar. " +
  "Toast: " + element("toast").textContent +
  " | erros: " + runtimeErrors.join(" || "));
assert.equal(button.disabled, false);
assert.equal(button.textContent, "Entrar no mundo →");
assert.equal(context.gameStarted, true);
assert.equal(element("toast").textContent,
  "Você entrou no mundo, mas parte da interface não foi carregada.");

assert.match(onlineModule, /dispatchEvent\(new Event\(["']ktk-online-ready["']\)\)/);
assert.match(html, /id="enter-world"/);
assert.match(html, /id="ktk-display-name"[^>]*aria-required="true"/);
assert.match(html, /game-lifecycle\.js\?v=20261117-realtime-entry-fix-001/);
assert.match(html, /online\.js\?v=20261118-inventory-interaction-v1/);
assert.doesNotMatch(lifecycle, /onProgress\s*:/);
assert.ok(lifecycle.indexOf("showScreen('game')") < lifecycle.indexOf("applyServerState(onlinePlayer.state)"),
  "A tela do mundo deve ser ativada antes de atualizar os dados visuais.");

console.log("World entry button, name validation, online-module readiness and error feedback passed.");
