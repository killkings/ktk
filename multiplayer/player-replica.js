/* Interpolação, representação dos jogadores remotos e API de estado do mundo. */
'use strict';

  function updateRemotePlayerMotion(dt) {
    const delta=Math.max(0,Number(dt)||0);
    const now=performance.now();
    remotePlayers.forEach(remote=>{
      const dx=(Number(remote.targetX)||0)-(Number(remote.x)||0);
      const dy=(Number(remote.targetY)||0)-(Number(remote.y)||0);
      const distance=Math.hypot(dx,dy);
      const maxStep=520*delta;
      if(distance>0.25&&maxStep>0) {
        const step=Math.min(distance,maxStep);
        remote.x+=(dx/distance)*step;
        remote.y+=(dy/distance)*step;
      } else if(distance<=0.25) {
        remote.x=Number(remote.targetX)||0;
        remote.y=Number(remote.targetY)||0;
      }
      const waitingForPacket=now-(Number(remote.lastPositionReceivedAt)||0);
      remote.moving=distance>0.5||(Boolean(remote.serverMoving)&&waitingForPacket<450);
      if(remote.moving) remote.walkTime=(remote.walkTime||0)+delta;
      else remote.walkTime=0;
      if(remote.knockback) {
        remote.knockback.progress=Math.min(1,(remote.knockback.progress||0)+delta/KNOCKBACK_SECONDS);
        remote.knockbackHeight=Math.sin(remote.knockback.progress*Math.PI)*KNOCKBACK_HEIGHT;
        if(remote.knockback.progress>=1) {
          remote.knockback=null;
          remote.knockbackHeight=0;
        }
      }
      if(Array.isArray(remote.remoteProjectiles)) {
        remote.remoteProjectiles=remote.remoteProjectiles.filter(projectile=>{
          projectile.elapsed+=delta;
          const step=projectile.speed*delta;
          if(projectile.projectileType==='boomerang'&&projectile.phase==='returning') {
            const bx=remote.x-projectile.x,by=remote.y-projectile.y;
            const distanceToPlayer=Math.hypot(bx,by);
            if(distanceToPlayer<=Math.max(step,BOOMERANG_PROJECTILE_RADIUS)) return false;
            projectile.x+=bx/distanceToPlayer*step;
            projectile.y+=by/distanceToPlayer*step;
            return true;
          }
          const travel=Math.min(step,Math.max(0,projectile.maxDistance-projectile.distance));
          projectile.distance+=travel;
          projectile.x+=projectile.vectorX*travel;
          projectile.y+=projectile.vectorY*travel;
          if(projectile.distance>=projectile.maxDistance) {
            if(projectile.projectileType==='boomerang') {
              projectile.phase='returning';
              return true;
            }
            return false;
          }
          return true;
        });
      }
    });
    const skeleton=window.KTKEnemySkeleton?.entity;
    if(skeleton?.remoteAttacking) {
      skeleton.remoteAttackElapsed=(skeleton.remoteAttackElapsed||0)+delta;
      if(skeleton.remoteAttackElapsed>=PUNCH_ANIMATION_SECONDS) skeleton.remoteAttacking=false;
    }
  }

  function normalizeRemoteWearables(source,previous={}) {
    const result={};
    wearableSlotOrder.forEach(slot=>{
      const entry=source&&Object.prototype.hasOwnProperty.call(source,slot)
        ? source[slot] : previous?.[slot];
      if(!entry) {
        result[slot]=null;
        return;
      }
      const itemId=entry.item_id||entry.itemId||entry.id;
      const catalogItem=equipmentCatalog?.items?.find(candidate=>String(candidate.id)===String(itemId));
      const suppliedLayers=Array.isArray(entry.appearanceLayers)&&entry.appearanceLayers.length
        ? entry.appearanceLayers : null;
      if(!catalogItem) {
        result[slot]={...entry,appearanceLayers:suppliedLayers||entry.appearanceLayers||[]};
        return;
      }
      result[slot]={
        ...catalogItem,
        ...entry,
        id:itemId||catalogItem.id,
        displayName:entry.displayName||entry.display_name||catalogItem.displayName||slot,
        wearCategory:entry.wearCategory||entry.wear_category||catalogItem.wearCategory||'cosmetic',
        durability:Number.isFinite(Number(entry.durability))
          ? Number(entry.durability) : Number(catalogItem.durability)||0,
        appearanceLayers:suppliedLayers||catalogItem.appearanceLayers||[],
        isKingCrown:Boolean(entry.isKingCrown||entry.is_king_crown||catalogItem.isKingCrown)
      };
    });
    return result;
  }

  function setRemotePlayers(players) {
    const incoming=new Set();
    (players||[]).forEach(remote=>{
      if(!remote || remote.id==null || !Number.isFinite(remote.x) || !Number.isFinite(remote.y)) return;
      const id=String(remote.id);
      incoming.add(id);
      const existing=remotePlayers.get(id);
      // A orientação remota é conferida pelo deslocamento entre pacotes.
      // Isso evita que um campo direction atrasado ou incorreto mostre a
      // frente do personagem quando ele está realmente caminhando para cima.
      let remoteDirection=Number.isFinite(remote.direction)
        ? Math.max(0,Math.min(3,remote.direction))
        : (existing?.direction??2);
      if(existing) {
        const previousTargetX=Number.isFinite(existing.targetX)?existing.targetX:existing.x;
        const previousTargetY=Number.isFinite(existing.targetY)?existing.targetY:existing.y;
        const movementX=remote.x-previousTargetX;
        const movementY=remote.y-previousTargetY;
        if(Math.hypot(movementX,movementY)>0.35) {
          if(Math.abs(movementX)>Math.abs(movementY)) {
            remoteDirection=movementX>0?3:1;
          } else {
            remoteDirection=movementY>0?2:0;
          }
        }
      }
      const entity=existing||{
        id,type:'player',x:remote.x,y:remote.y,targetX:remote.x,targetY:remote.y,
        direction:remoteDirection,radius:COLLISION_RADIUS,walkTime:0
      };
      entity.targetX=remote.x;
      entity.targetY=remote.y;
      entity.lastPositionReceivedAt=performance.now();
      entity.serverMoving=Boolean(remote.serverMoving??remote.moving);
      entity.direction=remoteDirection;
      entity.displayName=remote.displayName||remote.display_name||entity.displayName||'Aventureiro';
      entity.character=remote.character||entity.character||{};
      entity.wearables=normalizeRemoteWearables(remote.wearables,entity.wearables);
      entity.combatStats=remote.combatStats||entity.combatStats||{};
      entity.isKing=Boolean(kingCrownClaimedBy&&String(id)===String(kingCrownClaimedBy));
      entity.hasKingCrown=entity.isKing;
      entity.type='player';
      entity.radius=COLLISION_RADIUS;
      remotePlayers.set(id,entity);
      if(Array.isArray(remote.combatEvents)) {
        if(!entity.seenCombatEventIds) entity.seenCombatEventIds=new Set();
        remote.combatEvents.forEach(event=>{
          if(!event?.event_id||entity.seenCombatEventIds.has(event.event_id)) return;
          entity.seenCombatEventIds.add(event.event_id);
          if(event.kind==='attack_start') {
            const type=['punch','slash','thrust','shoot'].includes(event.attack_type)?event.attack_type:'slash';
            entity.attackAnimation={
              type,weaponId:event.weapon_id,direction:event.direction,
              duration:event.duration||PUNCH_ANIMATION_SECONDS,
              frameCount:event.frame_count||6,
              startedAt:performance.now()
            };
          } else if(event.kind==='projectile_start') {
            if(!Number.isFinite(event.projectile_x)||!Number.isFinite(event.projectile_y)) return;
            if(!entity.remoteProjectiles) entity.remoteProjectiles=[];
            entity.remoteProjectiles.push({
              id:event.event_id,type:'remote-projectile',
              projectileType:event.projectile_type,weaponId:event.weapon_id,
              x:event.projectile_x,y:event.projectile_y,
              vectorX:event.vector_x,vectorY:event.vector_y,
              direction:event.direction,speed:event.speed,
              maxDistance:event.max_distance,distance:0,elapsed:0,phase:'outbound'
            });
          } else if(event.kind==='player_damaged') {
            entity.knockback={x:event.knockback_x,y:event.knockback_y,progress:0};
            entity.knockbackHeight=0;
          } else if(event.kind==='pvp_hit') {
            const target=remotePlayers.get(String(event.target_user_id||""));
            if(target) {
              if(Number.isFinite(event.target_health)) {
                target.combatStats={...(target.combatStats||{}),health:event.target_health};
              }
              target.knockback={x:event.knockback_x,y:event.knockback_y,progress:0};
              target.knockbackHeight=0;
            }
          } else if(event.kind==='skeleton_hit') {
            const skeleton=window.KTKEnemySkeleton.entity;
            if(!skeleton.defeated&&event.damage>0) {
              skeleton.health=Math.max(0,skeleton.health-event.damage);
              skeleton.attacking=false;
              skeleton.attackElapsed=0;
              if(Number.isFinite(event.target_x)) skeleton.x=event.target_x;
              if(Number.isFinite(event.target_y)) skeleton.y=event.target_y;
              startKnockback(skeleton,{x:event.knockback_x,y:event.knockback_y});
              if(skeleton.health===0) skeleton.defeated=true;
              refreshSkeletonCombatStats();
            }
          } else if(event.kind==='skeleton_attack') {
            const skeleton=window.KTKEnemySkeleton.entity;
            if(!skeleton.defeated) {
              skeleton.remoteAttackDirection=event.direction;
              skeleton.remoteAttackElapsed=0;
              skeleton.remoteAttacking=true;
            }
          }
        });
        if(entity.seenCombatEventIds.size>128) {
          entity.seenCombatEventIds=new Set([...entity.seenCombatEventIds].slice(-64));
        }
      }
      if(!entity.layersReady || entity.appearanceSignature!==JSON.stringify({
        characterData:entity.character||{},wearables:entity.wearables||{}
      })) {
        void window.loadRemoteCharacterLayers(entity).catch(error=>console.warn('KTK remote appearance:',error));
      }
    });
    for(const id of remotePlayers.keys()) if(!incoming.has(id)) remotePlayers.delete(id);
    updateKingStatus();
  }
  function predictProjectile(spec={}) {
    const id=String(spec.id||'');
    if(!id) return false;
    const direction=Math.max(0,Math.min(3,Math.trunc(Number(spec.direction)||0)));
    const vectorX=direction===1?-1:direction===3?1:0;
    const vectorY=direction===0?-1:direction===2?1:0;
    const worldX=camera.x*canvas.clientWidth+player.x;
    const worldY=camera.y*canvas.clientHeight+player.y;
    const originX=worldX+vectorX*18;
    const originY=worldY+vectorY*18;
    const previous=serverWorldEntities.get(id);
    serverWorldEntities.set(id,{
      ...previous,
      type:'remote-projectile',id,entityId:id,
      x:originX,y:originY,targetX:originX,targetY:originY,
      originX,originY,distance:0,serverDistance:0,
      weaponId:String(spec.weaponId||''),
      projectileType:String(spec.projectileType||'magic'),
      vectorX,vectorY,direction,
      speed:Math.max(1,Number(spec.speed)||620),
      maxDistance:Math.max(1,Number(spec.maxDistance)||160),
      elapsed:0,phase:'outbound',predicted:true
    });
    return true;
  }

  window.KTKWorldEntities={
    setRemotePlayers,entities:getWorldEntities,applyServerState,predictProjectile,
    applyServerKnockback:(event,x,y,direction)=>{
      if(playerDead) return false;
      if(Number.isFinite(Number(x))&&Number.isFinite(Number(y))) {
        setLocalPlayerPosition(x,y,direction);
      }
      if(event) {
        player.knockback={
          x:Number(event.x)||0,y:Number(event.y)||0,progress:0,authoritative:true
        };
      }
      return true;
    },
    applyRemoteDamage:()=>false,
    applyWorldEntity,applyWorldState,
    serverDeath:()=>handlePlayerDeath(true),
    setLocalState:(x,y,direction)=>setLocalPlayerPosition(x,y,direction)
  };
