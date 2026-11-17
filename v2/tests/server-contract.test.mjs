import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL("../../supabase/migrations/20261117170000_ktk_v2_foundation.sql", import.meta.url);
const clientUrl = new URL("../js/main.js", import.meta.url);
const htmlUrl = new URL("../index.html", import.meta.url);
const [sql, client, html] = await Promise.all([
  readFile(migrationUrl, "utf8"),
  readFile(clientUrl, "utf8"),
  readFile(htmlUrl, "utf8")
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
  assert.match(sql, /where world_id = 'main' and entity_id = 'crown-main' and entity_type = 'crown'\\s+for update/i);
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
