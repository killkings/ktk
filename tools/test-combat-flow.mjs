import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [combatSource, movementSource, actionSource, stateSource, html, index, migration, pvpRuleMigration, worldEntities, worldRenderer, replicaSource, inputSource, playerSyncSource] = await Promise.all([
  read("../combat/combat-controller.js"),
  read("../online/movement.js"),
  read("../online/actions.js"),
  read("../js/game-state.js"),
  read("../campo_livre_atualizado.html"),
  read("../index.html"),
  read("../supabase/migrations/20261118005653_fix_combat_pipeline.sql"),
  read("../supabase/migrations/20261118011327_fix_same_clan_pvp_rule.sql"),
  read("../world/world-entities.js"),
  read("../render/world-renderer.js"),
  read("../multiplayer/player-replica.js"),
  read("../input/input-controller.js"),
  read("../online/player-sync.js")
]);

const combatStart = combatSource.indexOf("  function startPunch(event=null) {");
const combatEnd = combatSource.indexOf("  function getEntityWorldPosition(", combatStart);
const applyHitStart = combatSource.indexOf("  function applyCombatHit(");
const applyHitEnd = combatSource.indexOf("  function startKnockback(", applyHitStart);
assert.ok(combatStart >= 0 && combatEnd > combatStart, "Combat functions must remain in the expected module.");
assert.ok(applyHitStart >= 0 && applyHitEnd > applyHitStart, "The real server hit dispatcher must remain in the combat module.");
const combatExecutable = combatSource.slice(combatStart, combatEnd) +
  combatSource.slice(applyHitStart, applyHitEnd) +
  "\nglobalThis.combatApi={startPunch,updatePunch,resolvePunchHit,requestServerProjectile,applyCombatHit,isMagicWeapon};";

function makeCombatContext({ inventory, magicLevel = 0, response } = {}) {
  const calls = [];
  const toasts = [];
  const predicted = [];
  const localPlayer = { direction: 3, x: 10, y: 20 };
  const context = {
    console,
    performance: { now: () => 1000 },
    gameStarted: true,
    screens: { game: { classList: { contains: () => true } } },
    player: localPlayer,
    punch: {
      active:false,elapsed:0,cooldown:0,direction:2,hitApplied:false,
      weaponAttack:false,weaponItem:null,range:0.8,attackBonus:0,damageMultiplier:1
    },
    inventory: inventory || [null,null],
    selectedInventorySlot: 0,
    PUNCH_RANGE:0.8,
    PUNCH_COOLDOWN_SECONDS:0.5,
    PUNCH_IMPACT_SECONDS:0.2,
    PUNCH_ANIMATION_SECONDS:0.42,
    PUNCH_STAMINA_COST:3,
    window: {
      KTKPlayerStats: { stats: { magicLevel: { value: magicLevel } } },
      KTKOnline: {
        async gameAction(action,payload) {
          calls.push({action,payload});
          return response || {ok:true,hit:false};
        }
      },
      KTKWorldEntities: {
        predictProjectile(spec) { predicted.push(spec); return true; }
      }
    },
    toast(message) { toasts.push(String(message)); },
    applyServerState() {},
    getInnateMagicProfile() {
      return {attackBonus:6,range:3.5,attackType:"slash",attackFrameCount:6,
        manaCost:10,staminaCost:1.5,damageMultiplier:2};
    },
    startKnockback() {}
  };
  vm.createContext(context);
  vm.runInContext(combatExecutable, context);
  return { ...context, context, calls, toasts, predicted };
}

// 1) Unarmed mouse attack reaches the authoritative RPC with an explicit JSON null weapon.
const fist = makeCombatContext({
  response:{ok:true,hit:true,target_type:"player",damage:6,target_health:94}
});
fist.context.combatApi.startPunch();
fist.context.combatApi.updatePunch(0.21);
await new Promise(resolve => setImmediate(resolve));
assert.equal(fist.calls.length,1);
assert.equal(fist.calls[0].action,"attack");
assert.equal(fist.calls[0].payload.direction,3);
assert.equal(fist.calls[0].payload.weapon_id,null);
assert.ok(fist.toasts.some(message=>message.includes("6 de dano")),
  "A player hit must give the attacker feedback about dealt damage.");

// An empty hand must remain a punch even when innate magic is unlocked.
const highLevelFist = makeCombatContext({
  magicLevel:10,
  response:{ok:true,hit:true,target_type:"player",damage:6,target_health:94}
});
highLevelFist.context.combatApi.startPunch({altKey:true,ctrlKey:false});
highLevelFist.context.combatApi.updatePunch(0.21);
await new Promise(resolve => setImmediate(resolve));
assert.equal(highLevelFist.calls.length,1);
assert.equal(highLevelFist.calls[0].action,"attack",
  "Level-six innate magic must not silently replace an unarmed punch.");
assert.equal(highLevelFist.calls[0].payload.weapon_id,null);

// Holding Ctrl while clicking explicitly selects level-six innate magic.

// 2) A selected magic weapon takes the projectile route, not the unarmed/melee route.
const wand = makeCombatContext({
  inventory:[{id:"equipment-wand",equipmentClass:"magic",itemType:"equipment",range:7,attackInterval:0.7},null],
  response:{ok:true,projectile_id:"projectile-test-1"}
});
wand.context.combatApi.startPunch();
wand.context.combatApi.updatePunch(0.21);
await new Promise(resolve => setImmediate(resolve));
assert.equal(wand.calls.length,1);
assert.equal(wand.calls[0].action,"launch_projectile");
assert.equal(wand.calls[0].payload.weapon_id,"equipment-wand");
assert.ok(wand.toasts.includes("Feitiço lançado."));
assert.equal(wand.predicted.length,1);
assert.equal(wand.predicted[0].projectileType,"magic");
assert.equal(wand.predicted[0].speed,620);
assert.equal(wand.predicted[0].direction,3);

// 3) Level-six innate magic must also use the projectile action with the server item id.
const innate = makeCombatContext({magicLevel:6,response:{ok:true,projectile_id:"projectile-innate"}});
innate.context.combatApi.startPunch({ctrlKey:true});
innate.context.combatApi.updatePunch(0.21);
await new Promise(resolve => setImmediate(resolve));
assert.equal(innate.calls[0].action,"launch_projectile");
assert.equal(innate.calls[0].payload.weapon_id,"level-six-innate-magic");
assert.match(inputSource,/startPunch\(event\)/,
  "The mouse modifier must reach the combat controller.");

// The initial world snapshot loads existing health without replaying an old impact.
const worldEntityStart=worldEntities.indexOf("  function applyWorldEntity(");
const worldEntityEnd=worldEntities.indexOf("  function applyWorldState(",worldEntityStart);
assert.ok(worldEntityStart>=0&&worldEntityEnd>worldEntityStart);
const worldEntityCode=worldEntities.slice(worldEntityStart,worldEntityEnd)+
  "\nglobalThis.worldEntityApi={applyWorldEntity};";
const skeleton={x:100,y:100,health:100,maxHealth:100,defeated:false,attacking:true,attackElapsed:0};
let skeletonStatsRefreshes=0;
const worldEntityContext={
  serverEntityRevisions:new Map(),
  serverWorldEntities:new Map(),
  worldItems:new Set(),
  remotePlayers:new Map(),
  window:{KTKEnemySkeleton:{entity:skeleton}},
  startKnockback(target,vector){target.knockback={...vector,progress:0};},
  refreshSkeletonCombatStats(){skeletonStatsRefreshes++;}
};
vm.createContext(worldEntityContext);
vm.runInContext(worldEntityCode,worldEntityContext);
worldEntityContext.worldEntityApi.applyWorldEntity({
  entity_id:"skeleton-1",entity_type:"enemy",x:118,y:100,revision:1,
  state:{health:82,max_health:100,defeated:false}
},"snapshot");
assert.equal(skeleton.health,82,"The initial snapshot must load authoritative enemy health.");
assert.equal(skeleton.knockback,undefined,
  "The first snapshot must not replay an old impact from before joining.");

// Realtime damage must refresh health and visibly knock the enemy back.
worldEntityContext.worldEntityApi.applyWorldEntity({
  entity_id:"skeleton-1",entity_type:"enemy",x:136,y:100,revision:2,
  state:{health:64,max_health:100,defeated:false}
},"realtime");
assert.equal(skeleton.health,64,"The server-confirmed magic damage must update local enemy health.");
assert.equal(skeletonStatsRefreshes,2,"The enemy health display must refresh after the hit.");
assert.deepEqual({...skeleton.knockback},{x:1,y:0,progress:0},
  "A server-confirmed hit must replay its displacement as a visible impact.");
assert.equal(skeleton.attacking,false,"A confirmed hit interrupts the enemy attack animation.");

// A snapshot of the same revision must not restart an impact already shown.
const previousKnockback=skeleton.knockback;
worldEntityContext.worldEntityApi.applyWorldEntity({
  entity_id:"skeleton-1",entity_type:"enemy",x:136,y:100,revision:2,
  state:{health:64,max_health:100,defeated:false}
},"snapshot");
assert.equal(skeleton.knockback,previousKnockback,
  "A snapshot that repeats an already applied hit must not replay it.");

// A later snapshot may be the first delivery of a new confirmed hit: show it.
worldEntityContext.worldEntityApi.applyWorldEntity({
  entity_id:"skeleton-1",entity_type:"enemy",x:154,y:100,revision:3,
  state:{health:46,max_health:100,defeated:false}
},"snapshot");
assert.notEqual(skeleton.knockback,previousKnockback,
  "A new health reduction arriving by snapshot must also show its impact.");
assert.deepEqual({...skeleton.knockback},{x:1,y:0,progress:0});

// Older snapshots cannot roll the enemy state back or replay damage.
const latestKnockback=skeleton.knockback;
const acceptedStaleSnapshot=worldEntityContext.worldEntityApi.applyWorldEntity({
  entity_id:"skeleton-1",entity_type:"enemy",x:172,y:100,revision:2,
  state:{health:20,max_health:100,defeated:false}
},"snapshot");
assert.equal(acceptedStaleSnapshot,false);
assert.equal(skeleton.health,46);
assert.equal(skeleton.knockback,latestKnockback);

// The database retains responsibility for computing and applying the projectile's damage and push.
assert.ok(pvpRuleMigration.includes("'damage',greatest(1,round("));
assert.ok(pvpRuleMigration.includes("v_damage:=greatest(1,coalesce((v_proj->>'damage')::integer,5))"));
assert.ok(pvpRuleMigration.includes("'health',greatest(0,v_target_health-v_damage)"));
assert.ok(pvpRuleMigration.includes("x=x+(v_dx/v_len)*18,y=y+(v_dy/v_len)*18"));


// 4) The position action flush broadcasts first and persists the exact local point before returning.
const movementCode = movementSource
  .replace(/^import .*;\s*$/gm,"")
  .replace(/^export function /gm,"function ")
  .replace(/^export async function /gm,"async function ");
const sequence = [];
const movementState = {
  user:{id:"attacker"},sessionId:"session-1",displayName:"Teste",
  online:true,joined:true,leaving:false,lastPositionCheckpointAt:0,
  channel:{send(message){sequence.push({kind:"broadcast",message});return Promise.resolve("ok");}}
};
const movementWindow = {
  player:{x:123.5,y:456.25,direction:3},
  playerInputX:1,playerInputY:0,playerMoving:true,playerRunning:false,
  rightMouseHeld:false,shieldStaminaExhausted:false,getBlockingShield:()=>null
};
const movementContext = {
  state:movementState,window:movementWindow,performance:{now:()=>5000},
  Date,console,
  supabase:{rpc(name,args){sequence.push({kind:"rpc",name,args});return Promise.resolve({error:null});}}
};
vm.createContext(movementContext);
vm.runInContext(movementCode+";globalThis.movementApi={sendPosition,syncPositionForAction,resetMovementNetwork};",movementContext);
await movementContext.movementApi.syncPositionForAction();
assert.deepEqual(sequence.map(entry=>entry.kind),["broadcast","rpc"]);
assert.equal(sequence[1].name,"ktk_checkpoint_position");
assert.equal(sequence[1].args.p_x,123.5);
assert.equal(sequence[1].args.p_y,456.25);
assert.equal(sequence[1].args.p_direction,3);
assert.equal(sequence[1].args.p_input_x,1);

// 5) gameAction must flush position before attack/projectile RPCs, but not unrelated actions.
const actionCode = actionSource
  .replace(/^import .*;\s*$/gm,"")
  .replace(/^export async function /gm,"async function ");
const actionEvents = [];
const actionState = {user:{id:"attacker"},sessionId:"session-1",online:true,joined:true,leaving:false};
const actionContext = {
  state:actionState,
  supabase:{rpc:async(name,args)=>{
    actionEvents.push({kind:"rpc",name,args});
    return {data:{ok:true,hit:false,state:{health:90}},error:null};
  }},
  syncPositionForAction:async()=>{actionEvents.push({kind:"position"});},
  loadWorldState:()=>new Promise(()=>{}),
  window:{KTKWorldEntities:{applyServerState:()=>actionEvents.push({kind:"apply"})}},
  console
};
vm.createContext(actionContext);
vm.runInContext(actionCode+";globalThis.actionApi={gameAction};",actionContext);
const attackResult=await actionContext.actionApi.gameAction("attack",{direction:3,weapon_id:null});
assert.equal(attackResult.ok,true);
assert.deepEqual(actionEvents.slice(0,3).map(event=>event.kind),["position","rpc","apply"]);
assert.equal(actionEvents[1].args.p_action,"attack");
assert.equal(actionEvents[1].args.p_payload.weapon_id,null);

actionEvents.length=0;
const launchResult=await actionContext.actionApi.gameAction("launch_projectile",{direction:3,weapon_id:"equipment-wand"});
assert.equal(launchResult.ok,true);
assert.deepEqual(actionEvents.slice(0,3).map(event=>event.kind),["position","rpc","apply"]);
assert.equal(actionEvents[1].args.p_action,"launch_projectile");

actionEvents.length=0;
actionContext.loadWorldState=async()=>{actionEvents.push({kind:"snapshot"});};
await actionContext.actionApi.gameAction("magic_level",{});
assert.equal(actionEvents.some(event=>event.kind==="position"),false,
  "Magic-level changes are not position-sensitive combat actions.");
assert.equal(actionEvents.some(event=>event.kind==="rpc"),true);

// 6) Combat changes must not rewrite the walking physics constants or its motion function.
assert.match(stateSource,/var\s+SPEED\s*=\s*225/);
assert.match(stateSource,/function updateLocalPlayerVisual\(deltaSeconds\)/);
assert.match(movementSource,/MOVING_CHECKPOINT_INTERVAL\s*=\s*500/);
assert.match(html,/combat-controller\.js\?v=20261118-ctrl-impact-v1/);
assert.match(html,/online\.js\?v=20261118-inventory-interaction-v1/);
assert.match(html,/player-replica\.js\?v=20261118-inventory-interaction-v1/);
assert.match(html,/world\/world-entities\.js\?v=20261118-ctrl-impact-v2/);
assert.match(html,/world-renderer\.js\?v=20261117-combat-v1/);
assert.match(html,/input-controller\.js\?v=20261118-wearables-separated-v1/);
assert.match(index,/20261118-inventory-interaction-v1/);
assert.match(replicaSource,/function predictProjectile\(/);
assert.match(worldRenderer,/entity\.type==='remote-projectile'&&entity\.phase==='outbound'/);

// 7) The database migration must address the SQL NULL bug and moving-target positions.
assert.match(migration,/coalesce\(to_jsonb\(v_item_id\),'null'::jsonb\)/);
assert.match(migration,/estimate_player_position/);
assert.match(migration,/last_attack_weapon_id/);
assert.match(migration,/p_position_updated_at/);


// 8) Same-clan PvP remains enabled except for attacks against the king by their own clan.
const kingGuardMatches = [...pvpRuleMigration.matchAll(/p\.user_id\s*=\s*\(select w\.king_user_id from public\.ktk_worlds w where w\.id='main'\)/g)];
assert.equal(kingGuardMatches.length,2,
  "Both melee and projectile targeting must protect only the king from their own clan.");
assert.match(pvpRuleMigration,/a\.clan_color=b\.clan_color/);
assert.match(pvpRuleMigration,/owner_profile\.clan_color=target_profile\.clan_color/);
assert.doesNotMatch(pvpRuleMigration,/and not\(a\.clan_color is not null and a\.clan_color=b\.clan_color\)/);
assert.doesNotMatch(pvpRuleMigration,/and not\(owner_profile\.clan_color is not null and owner_profile\.clan_color=target_profile\.clan_color\)/);


/* 9) A PvP knockback must reach the attacking client's remote sprite exactly once. */
const syncExecutable = playerSyncSource
  .replace(/^import .*;\s*$/gm,"")
  .replace(/^export async function /gm,"async function ")
  .replace(/^export function /gm,"function ");
const syncState = {
  user:{id:"attacker"},leaving:false,sessionId:"session-1",
  remote:new Map([["victim",{
    id:"victim",x:100,y:100,targetX:100,targetY:100,direction:3,
    display_name:"Victim",displayName:"Victim",character:{},wearables:{},
    combatStats:{},serverMoving:false,lastServerKnockbackAt:"previous-hit"
  }]]),
  profileCache:new Map([["victim",{display_name:"Victim",character:{}}]]),
  profileLoads:new Map(),profileRetryTimers:new Map(),profileRetryCounts:new Map()
};
const remoteSyncUpdates=[];
const syncContext={
  state:syncState,supabase:{},WORLD_ID:"main",
  window:{KTKWorldEntities:{setRemotePlayers(players){remoteSyncUpdates.push(players);}}},
  performance:{now:()=>1000},console,Date,setTimeout,clearTimeout
};
vm.createContext(syncContext);
vm.runInContext(syncExecutable+";globalThis.syncApi={acceptDatabaseChange};",syncContext);
syncContext.syncApi.acceptDatabaseChange({
  user_id:"victim",x:72,y:100,direction:1,is_alive:true,
  display_name:"Victim",character:{},
  state:{
    wearables:{},health:94,max_health:100,
    last_knockback_at:"new-hit",
    last_knockback:{x:-1,y:0}
  }
});
const syncedVictim=syncState.remote.get("victim");
assert.equal(syncedVictim.x,72);
assert.equal(syncedVictim.targetX,72);
assert.equal(syncedVictim.direction,3,
  "The database knockback must not overwrite the victim's facing direction.");
assert.equal(syncedVictim.lastServerKnockbackAt,"new-hit");
assert.ok(syncedVictim.knockback);
assert.equal(remoteSyncUpdates.length,2,
  "The changed remote hit must be sent to the renderer after acceptRemote.");

const replicaStart=replicaSource.indexOf("  function updateRemotePlayerMotion(");
const replicaEnd=replicaSource.indexOf("  function predictProjectile(",replicaStart);
assert.ok(replicaStart>=0&&replicaEnd>replicaStart);
const replicaExecutable=replicaSource.slice(replicaStart,replicaEnd);
const previousVisual={
  id:"victim",type:"player",x:100,y:100,targetX:100,targetY:100,direction:3,
  radius:12,walkTime:0,layersReady:true,character:{},wearables:{},
  appearanceSignature:JSON.stringify({characterData:{},wearables:{}}),
  lastServerKnockbackAt:"previous-hit"
};
const replicaContext={
  remotePlayers:new Map([["victim",previousVisual]]),
  wearableSlotOrder:[],equipmentCatalog:{items:[]},
  COLLISION_RADIUS:12,KNOCKBACK_SECONDS:0.2,KNOCKBACK_HEIGHT:12,
  PUNCH_ANIMATION_SECONDS:0.42,kingCrownClaimedBy:null,
  window:{KTKEnemySkeleton:{entity:null},loadRemoteCharacterLayers:()=>Promise.resolve()},
  performance:{now:()=>2000},updateKingStatus(){}
};
vm.createContext(replicaContext);
vm.runInContext(replicaExecutable+";globalThis.replicaApi={setRemotePlayers,updateRemotePlayerMotion};",replicaContext);
replicaContext.replicaApi.setRemotePlayers([syncedVictim]);
const victimSprite=replicaContext.remotePlayers.get("victim");
assert.equal(victimSprite.direction,3,
  "A knockback displacement must not turn the victim's sprite.");
assert.equal(victimSprite.targetX,72,
  "The attacker's client must receive the authoritative pushed-back position.");
assert.ok(victimSprite.knockback,
  "The remote player must receive the red damage-flash state.");
replicaContext.replicaApi.updateRemotePlayerMotion(0.05);
assert.ok(victimSprite.knockbackHeight>0,
  "The remote player's jump/knockback elevation must animate.");
const knockbackProgress=victimSprite.knockback.progress;
replicaContext.replicaApi.setRemotePlayers([syncedVictim]);
assert.equal(victimSprite.knockback.progress,knockbackProgress,
  "Ordinary repeated updates must not restart the same hit animation.");
assert.match(worldRenderer,/Boolean\(entity\.knockback\)/);
assert.match(worldRenderer,/screenY-\(entity\.knockbackHeight\|\|0\)/);

console.log("Combat flow passed: Ctrl-triggered innate magic, authoritative enemy damage/impact rendering, magic projectiles, PvP rules, remote hit feedback, and preserved walking physics.");
