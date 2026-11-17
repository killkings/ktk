import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../online/realtime.js", import.meta.url), "utf8");
const executable = source
  .replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm, "")
  .replace(/^export\s+/gm, "");

function buildHarness(status, channelError = null) {
  const pendingRequest = new Promise(() => {});
  pendingRequest.abortSignal = () => pendingRequest;

  const state = {
    user: { id: "player-test" },
    sessionId: "session-test",
    leaving: false,
    online: false,
    joined: false,
    channel: null,
    worldStateRequestId: 0
  };
  const calls = { topic: "", config: null, playerSnapshot: 0, worldSnapshot: 0, errors: [] };
  const channel = {
    on() { return this; },
    subscribe(callback) {
      queueMicrotask(() => callback(status, channelError));
      return this;
    }
  };
  const supabase = {
    realtime: { async setAuth() {} },
    channel(topic, options) {
      calls.topic = topic;
      calls.config = options.config;
      return channel;
    },
    rpc(name) {
      if(name === "ktk_get_world_state") calls.worldSnapshot++;
      return pendingRequest;
    }
  };
  const loadExistingPlayers = () => {
    calls.playerSnapshot++;
    return pendingRequest;
  };
  const withTimeout = (_label, _duration, operation) => {
    if(typeof operation === "function") {
      return Promise.resolve().then(() => operation(new AbortController().signal));
    }
    return Promise.resolve(operation);
  };
  const window = { KTKWorldEntities: { applyWorldState() {} } };
  const console = {
    error(...args) { calls.errors.push(args); },
    warn() {}
  };
  const factory = new Function(
    "state", "supabase", "TOPIC", "acceptDatabaseChange",
    "acceptWorldEntityChange", "loadExistingPlayers", "withTimeout",
    "window", "console", "setTimeout", "clearTimeout",
    executable + "\nreturn { subscribeWorld };"
  );
  const { subscribeWorld } = factory(
    state, supabase, "world:main", () => {}, () => {},
    loadExistingPlayers, withTimeout, window, console, setTimeout, clearTimeout
  );
  return { state, calls, subscribeWorld };
}

assert.doesNotMatch(source, /\bsetStatus\s*\(/,
  "subscribeWorld não pode chamar uma função que não pertence ao módulo.");
assert.doesNotMatch(source, /\.track\s*\(/,
  "O canal autoritativo não deve depender de Presence.");
assert.match(source, /Promise\.allSettled/,
  "As fotografias iniciais não podem bloquear a entrada.");

const healthy = buildHarness("SUBSCRIBED");
await healthy.subscribeWorld();
await Promise.resolve();
assert.equal(healthy.state.online, true);
assert.equal(healthy.calls.topic, "world:main");
assert.equal(healthy.calls.config.private, true);
assert.equal(healthy.calls.config.presence, undefined);
assert.equal(healthy.calls.playerSnapshot, 1);
assert.equal(healthy.calls.worldSnapshot, 1);

const channelError = {
  name: "RealtimeError",
  message: "RLS policy rejected the channel join",
  code: "42501",
  hint: "Check the private channel SELECT policy."
};
const failed = buildHarness("CHANNEL_ERROR", channelError);
await assert.rejects(
  failed.subscribeWorld(),
  /RLS policy rejected the channel join/
);
assert.equal(failed.calls.errors.some(args => args[2] === channelError), true,
  "O erro original do Realtime deve ser registrado integralmente.");
assert.equal(failed.state.online, false);

console.log("Realtime entry, non-blocking snapshots, no-Presence channel and detailed error handling passed.");
