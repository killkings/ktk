import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL("../../supabase/migrations/20261117170000_ktk_v2_foundation.sql", import.meta.url);
const clientUrl = new URL("../js/main.js", import.meta.url);
const htmlUrl = new URL("../index.html", import.meta.url);
const rendererUrl = new URL("../js/world-renderer.js", import.meta.url);
const lpcUrl = new URL("../js/lpc-renderer.js", import.meta.url);
const rulesUrl = new URL("../js/client-rules.js", import.meta.url);
const catalogUrl = new URL("../../personagem.js", import.meta.url);
const [sql, client, html, renderer, lpc, rules, catalog] = await Promise.all([
  readFile(migrationUrl, "utf8"),
  readFile(clientUrl, "utf8"),
  readFile(htmlUrl, "utf8"),
  readFile(rendererUrl, "utf8"),
  readFile(lpcUrl, "utf8"),
  readFile(rulesUrl, "utf8"),
  readFile(catalogUrl, "utf8")
]);

test("V2 schema is isolated and does not rewrite V1 data", () => {
  assert.match(sql, /create table public\.ktk_v2_worlds/i);
  assert.match(sql, /create table public\.ktk_v2_players/i);
  assert.match(sql, /create table public\.ktk_v2_entities/i);
  assert.doesNotMatch(sql, /\b(drop|truncate)\s+table\s+public\.ktk_(?!v2_)/i);
  assert.doesNotMatch(sql, /\b(delete\s+from|update)\s+public\.ktk_(?!v2_)/i);
});

test("clients cannot mutate the V2 tables directly", () => {
  for (const table of ["ktk_v2_worlds", "ktk_v2_players", "ktk_v2_entities"]) {
    assert.match(sql, new RegExp("revoke all on table public\\." + table + " from public, anon, authenticated", "i"));
    assert.match(sql, new RegExp("grant select on table public\\." + table + " to authenticated", "i"));
  }
});

test("all V2 state transitions are exposed as authenticated RPCs only", () => {
  const functions = [
    "ktk_v2_enter_world(text,jsonb)",
    "ktk_v2_world_state()",
    "ktk_v2_step_player(smallint,smallint,boolean,boolean)",
    "ktk_v2_leave_world()",
    "ktk_v2_claim_crown()"
  ];
  for (const signature of functions) {
    assert.match(sql, new RegExp("revoke all on function public\\." + signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " from public, anon", "i"));
    assert.match(sql, new RegExp("grant execute on function public\\." + signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " to authenticated", "i"));
  }
});

test("server movement and crown transitions are transaction-serialized", () => {
  assert.match(sql, /pg_advisory_xact_lock\(pg_catalog\.hashtext\('ktk-v2:main:movement'\)\)/i);
  assert.match(sql, /create or replace function public\.ktk_v2_claim_crown/i);
  assert.match(sql, /where id = 'main' for update/i);
  assert.match(sql, /where world_id = 'main' and entity_id = 'crown-main' and entity_type = 'crown'\s+for update/i);
});

test("client has no durable browser storage", () => {
  const source = client + "\n" + html;
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|serviceWorker|caches\./i);
  assert.match(client, /persistSession:\s*false/);
});

test("the browser sends controls and never increments world coordinates", () => {
  assert.match(client, /ktk_v2_step_player/);
  assert.doesNotMatch(client, /(?:player|local)\.(?:x|y)\s*\+=/);
  assert.doesNotMatch(client, /(?:player|local)\.(?:x|y)\s*=/);
});


test("private presence channel has narrowly-scoped receive and publish policies", () => {
  assert.match(sql, /KTK V2 clients can receive world presence/i);
  assert.match(sql, /KTK V2 clients can publish own presence/i);
  assert.match(sql, /for insert to authenticated\s+with check \([\s\S]*extension = 'presence'/i);
  assert.match(client, /await supabase\.realtime\.setAuth\(\)/);
});

test("creator and local/remote players use the same real LPC sprite catalog", () => {
  assert.match(html, /\.\.\/personagem\.js/);
  assert.match(catalog, /"id":"hair_pixie"/);
  assert.match(catalog, /hair\/pixie\/adult\/walk\.png/);
  assert.match(lpc, /Universal-LPC-Spritesheet-Character-Generator\/04140673ec02906f8233523639733c83690df750/);
  assert.match(lpc, /body\/bodies\//);
  assert.match(lpc, /path:\"body\/bodies\/\"\+gender/);
  assert.match(lpc, /mode === "skin" \? appearance\.skin/);
  assert.match(lpc, /mode === "face" \? appearance\.skin \+ ":" \+ appearance\.eyes/);
  assert.match(lpc, /mode === "hair" \? appearance\.hair/);
  assert.match(lpc, /drawClothedFallback/);
  assert.match(renderer, /lpcRenderer\.draw\(ctx, player, x, y, deltaSeconds\)/);
  assert.match(client, /new LPCRenderer\(\)/);
});

test("all V2 JavaScript modules parse as ES modules", () => {
  const stripImports = source => source
    .replace(/^import\s+[\s\S]*?;\s*/gm, "")
    .replace(/^export\s+/gm, "");
  assert.doesNotThrow(() => new Function(stripImports(client)), "main.js");
  assert.doesNotThrow(() => new Function(stripImports(renderer)), "world-renderer.js");
  assert.doesNotThrow(() => new Function(stripImports(lpc)), "lpc-renderer.js");
  assert.doesNotThrow(() => new Function(stripImports(rules)), "client-rules.js");
});

test("old player-death and entity-delete broadcasts cannot roll back newer state", () => {
  assert.match(client, /incomingRevision <= previous\.revision/);
  assert.match(client, /if \(revision < knownRevision\) return/);
  assert.match(client, /if \(revision <= knownRevision\) return/);
});


test("spawn selection shares the same world movement lock", () => {
  const enter = sql.slice(
    sql.indexOf("create or replace function public.ktk_v2_enter_world"),
    sql.indexOf("create or replace function public.ktk_v2_world_state")
  );
  assert.match(enter, /pg_advisory_xact_lock\(pg_catalog\.hashtext\('ktk-v2:main:movement'\)\)/);
});

test("the V2 migration has one clean commit boundary", () => {
  assert.equal((sql.match(/\bcommit;/gi) || []).length, 1);
  assert.equal(sql.trimEnd().toLowerCase().endsWith("commit;"), true);
});

test("movement requests have a timeout and are aborted on exit", () => {
  assert.match(client, /movementTimeout = setTimeout\(\(\) => movementController\.abort\(\), 1500\)/);
  assert.match(client, /state\.movementController\?\.abort\(\)/);
});
