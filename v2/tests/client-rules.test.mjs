import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeControls,
  isNewerRevision,
  createPlayerView,
  reconcilePlayerView,
  advancePlayerView
} from "../js/client-rules.js";

test("normalizes controls and prevents running without movement", () => {
  assert.deepEqual(normalizeControls({x:4,y:-2,running:true}), {
    x:1,y:-1,running:true,guarding:false
  });
  assert.deepEqual(normalizeControls({x:0,y:0,running:true,guarding:true}), {
    x:0,y:0,running:false,guarding:true
  });
  assert.deepEqual(normalizeControls({x:NaN,y:Infinity}), {
    x:0,y:0,running:false,guarding:false
  });
});

test("server revisions must strictly increase", () => {
  assert.equal(isNewerRevision(2,1),true);
  assert.equal(isNewerRevision(1,1),false);
  assert.equal(isNewerRevision(0,1),false);
  assert.equal(isNewerRevision(-1,0),false);
  assert.equal(isNewerRevision("not-a-number",0),false);
});

test("player views require valid server coordinates and revision", () => {
  assert.equal(createPlayerView({x:1,y:2,revision:3,user_id:"a"}).targetX,1);
  assert.equal(createPlayerView({x:NaN,y:2,revision:3}),null);
  assert.equal(createPlayerView({x:1,y:2,revision:1.5}),null);
});

test("an old realtime update cannot roll back a newer position", () => {
  const first = createPlayerView({
    user_id:"player-a",display_name:"A",x:100,y:100,direction:2,revision:8,is_alive:true
  });
  const stale = reconcilePlayerView(first,{
    user_id:"player-a",display_name:"A",x:10,y:10,direction:1,revision:7,is_alive:true
  });
  assert.equal(stale,first);
  assert.equal(stale.targetX,100);
  const newer = reconcilePlayerView(first,{
    user_id:"player-a",display_name:"A",x:120,y:125,direction:3,revision:9,is_alive:true
  });
  assert.equal(newer.targetX,120);
  assert.equal(newer.visualX,100);
});

test("render interpolation moves only the visual replica", () => {
  const view = createPlayerView({
    user_id:"player-a",x:100,y:100,direction:2,revision:1,is_alive:true
  });
  const updated = reconcilePlayerView(view,{
    user_id:"player-a",x:200,y:100,direction:3,revision:2,is_alive:true
  });
  const rendered = advancePlayerView(updated,0.05);
  assert.equal(updated.x,200);
  assert.equal(updated.targetX,200);
  assert.equal(rendered.x,200);
  assert.ok(rendered.visualX > 100 && rendered.visualX < 200);
  assert.equal(updated.visualX,100);
});
