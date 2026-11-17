import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const timeoutSource = await readFile(new URL("../online/request-timeout.js", import.meta.url), "utf8");
const { withTimeout } = await import("data:text/javascript;charset=utf-8," + encodeURIComponent(timeoutSource));

let resolvedSignalAborted = false;
const value = await withTimeout("Teste de sucesso", 200, signal => {
  signal.addEventListener("abort", () => { resolvedSignalAborted = true; });
  return Promise.resolve("ok");
});
assert.equal(value, "ok");
assert.equal(resolvedSignalAborted, true);

let timedSignalAborted = false;
await assert.rejects(
  withTimeout("Consulta de teste", 15, signal => new Promise(() => {
    signal.addEventListener("abort", () => { timedSignalAborted = true; });
  })),
  /Consulta de teste não respondeu em 1 segundos/
);
assert.equal(timedSignalAborted, true);

const session = await readFile(new URL("../online/session.js", import.meta.url), "utf8");
const realtimeSource = await readFile(new URL("../online/realtime.js", import.meta.url), "utf8");
const playerSyncSource = await readFile(new URL("../online/player-sync.js", import.meta.url), "utf8");
const catalog = await readFile(new URL("../equipment/catalog-sync.js", import.meta.url), "utf8");
const lifecycle = await readFile(new URL("../game/game-lifecycle.js", import.meta.url), "utf8");

assert.match(session, /A sincronização do catálogo de equipamentos/);
assert.match(session, /A entrada do personagem no servidor/);
assert.match(session, /function reportEntryProgress\(_options, message\)/);
assert.doesNotMatch(session, /options\.onProgress|setStatus\("● " \+ message/);
assert.match(realtimeSource, /A autorização do canal multiplayer/);
assert.match(realtimeSource, /A consulta dos jogadores presentes/);
assert.match(realtimeSource, /A consulta do estado compartilhado do mundo/);
assert.match(realtimeSource, /Promise\.allSettled/);
assert.match(realtimeSource, /\.subscribe\(\(status, err\) =>/);
assert.doesNotMatch(realtimeSource, /\bsetStatus\s*\(/);
assert.doesNotMatch(realtimeSource, /\.track\s*\(/);
assert.doesNotMatch(realtimeSource, /presence\s*:/);
assert.doesNotMatch(session, /trackPresence|Lendo o estado inicial do personagem|getPlayerState\\(signal\\)/);
assert.match(playerSyncSource, /request = request\.abortSignal\(signal\)/);
assert.match(catalog, /request=request\.abortSignal\(signal\)/);
assert.doesNotMatch(lifecycle, /onProgress\s*:/);
assert.ok(lifecycle.indexOf("showScreen('game')") < lifecycle.indexOf("applyServerState(onlinePlayer.state)"));

console.log("Online entry phase deadlines, abort signals and progress checks passed.");
