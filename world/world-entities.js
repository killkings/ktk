/* Representação local das entidades do mundo autoritativo. */
'use strict';

  function getWorldEntities() {
    const skeleton=window.KTKEnemySkeleton.entity;
    const entities=skeleton.lastServerRevision>0&&!skeleton.defeated?[skeleton]:[];
    worldItems.forEach(item=>{if(!item.collected) entities.push(item);});
    serverWorldEntities.forEach(entity=>entities.push(entity));
    remotePlayers.forEach(remote=>{
      entities.push({type:'player',radius:COLLISION_RADIUS,...remote});
    });
    return entities;
  }

  function makeServerDropItem(itemId, serverData={}) {
    const definitions={
      'resource-wood':{displayName:'Madeira',itemType:'material',iconEmoji:'🪵'},
      'resource-stone':{displayName:'Pedra',itemType:'material',iconEmoji:'🪨'},
      'resource-berries':{displayName:'Frutas silvestres',itemType:'food',iconEmoji:'🍓'},
      'resource-water':{displayName:'Água limpa',itemType:'drink',iconEmoji:'💧'}
    };
    const definition=definitions[String(itemId||'')];
    if(!definition) return null;
    return {
      id:String(itemId),type:'item',itemType:definition.itemType,equipmentClass:'resource',
      displayName:String(serverData.display_name||definition.displayName),iconEmoji:definition.iconEmoji,
      quantity:Math.max(1,Number(serverData.quantity)||1),
      durability:Number(serverData.durability)||0,maxDurability:Number(serverData.max_durability)||0,
      category:'Recursos',radius:12,collected:false
    };
  }

  function applyWorldEntity(row, source='realtime') {
    if(!row||!row.entity_id) return false;
    const entityId=String(row.entity_id);
    const worldState=row.state&&typeof row.state==='object'?row.state:{};
    const incomingRevision=Math.max(0,Number(row.revision)||0);
    const previousRevision=serverEntityRevisions.get(entityId);
    const knownRevision=Number(previousRevision?.revision)||0;
    if(incomingRevision>0 && (
      incomingRevision<knownRevision ||
      (incomingRevision===knownRevision && previousRevision?.deleted && !row.deleted)
    )) return false;
    if(row.deleted) {
      serverEntityRevisions.set(entityId,{
        revision:Math.max(knownRevision,incomingRevision),
        deleted:true
      });
      serverWorldEntities.delete(entityId);
      worldItems.forEach(item=>{if(item.entityId===entityId) worldItems.delete(item);});
      return true;
    }
    if(incomingRevision>0) {
      serverEntityRevisions.set(entityId,{revision:incomingRevision,deleted:false});
      if(serverEntityRevisions.size>4096) {
        const oldest=serverEntityRevisions.keys().next().value;
        if(oldest!==undefined) serverEntityRevisions.delete(oldest);
      }
    }
    if(row.entity_type==='projectile') {
      const previous=serverWorldEntities.get(entityId);
      const x=Number(row.x)||0, y=Number(row.y)||0;
      const vectorX=Number(worldState.vector_x)||0;
      const vectorY=Number(worldState.vector_y)||0;
      const serverDistance=Math.max(0,Number(worldState.distance)||0);
      const distance=Math.max(Number(previous?.distance)||0,serverDistance);
      const originX=Number.isFinite(previous?.originX)?previous.originX:x-vectorX*serverDistance;
      const originY=Number.isFinite(previous?.originY)?previous.originY:y-vectorY*serverDistance;
      serverWorldEntities.set(entityId,{
        type:'remote-projectile',id:entityId,entityId,
        x:previous?.x??x,y:previous?.y??y,targetX:x,targetY:y,
        originX,originY,distance,serverDistance,
        revision:incomingRevision,
        weaponId:String(worldState.weapon_id||previous?.weaponId||''),
        projectileType:String(worldState.projectile_type||previous?.projectileType||'arrow'),
        vectorX,vectorY,
        direction:Number.isFinite(Number(worldState.direction))?Number(worldState.direction):2,
        speed:Number(worldState.speed)||previous?.speed||600,
        maxDistance:Number(worldState.max_distance)||previous?.maxDistance||160,
        elapsed:previous?.elapsed||0,phase:String(worldState.phase||'outbound'),
        predicted:true
      });
      return true;
    }
    if(row.entity_type==='resource') {
      const previous=serverWorldEntities.get(entityId);
      const x=Number(row.x)||0, y=Number(row.y)||0;
      serverWorldEntities.set(entityId,{
        type:'resource',id:entityId,entityId,resourceKind:String(worldState.resource_kind||'resource'),
        displayName:String(worldState.display_name||'Recurso'),health:Number(worldState.health)||0,
        maxHealth:Number(worldState.max_health||worldState.health)||1,status:String(worldState.status||'ready'),
        requiredTool:worldState.required_tool||null,
        x:previous?.x??x,y:previous?.y??y,targetX:x,targetY:y,
        revision:incomingRevision
      });
      return true;
    }
    if(entityId==='king-crown') {
      if(source!=='snapshot') crownRealtimeSeen=true;
      const crown=getKingCrownItem();
      if(!crown) return false;
      if(worldState.status==='ground') {
        crown.x=Number(row.x)||0;
        crown.y=Number(row.y)||0;
        crown.collected=false;
        worldItems.add(crown);
        kingCrownClaimedBy=null;
      } else {
        crown.collected=true;
        worldItems.delete(crown);
        kingCrownClaimedBy=worldState.owner_id||null;
      }
      remotePlayers.forEach((remote,id)=>{
        remote.isKing=Boolean(kingCrownClaimedBy&&String(id)===String(kingCrownClaimedBy));
        remote.hasKingCrown=remote.isKing;
      });
      updateKingStatus();
      return true;
    }
    if(row.entity_type==='item') {
      const itemId=String(worldState.item_id||'');
      const existing=[...worldItems].find(item=>item.entityId===entityId);
      if(worldState.status==='ground') {
        let base=itemId==='longsword-1'?window.KTKWorldSword?.entity:equipmentCatalog?.items.find(item=>item.id===itemId);
        if(!base) base=makeServerDropItem(itemId,worldState);
        if(!base) return false;
        const item={...base,...worldState,id:itemId,entityId,x:Number(row.x)||0,y:Number(row.y)||0,revision:incomingRevision,collected:false,isStartingWearable:false};
        if(existing) Object.assign(existing,item);
        else worldItems.add(item);
      } else if(existing) {
        existing.collected=true;
        worldItems.delete(existing);
      }
      return true;
    }
    if(entityId==='skeleton-1'&&window.KTKEnemySkeleton?.entity) {
      const skeleton=window.KTKEnemySkeleton.entity;
      const previousX=Number(skeleton.x)||0;
      const previousY=Number(skeleton.y)||0;
      const previousHealth=Number(skeleton.health);
      const nextX=Number(row.x)||0;
      const nextY=Number(row.y)||0;
      const nextHealth=Number.isFinite(Number(worldState.health))
        ? Number(worldState.health) : skeleton.health;
      const tookDamage=Number.isFinite(previousHealth)&&Number(nextHealth)<previousHealth;
      const hadServerState=Number(skeleton.lastServerRevision)>0;
      skeleton.lastServerRevision=incomingRevision;
      skeleton.x=nextX;
      skeleton.y=nextY;
      skeleton.health=nextHealth;
      skeleton.maxHealth=Number.isFinite(Number(worldState.max_health))?Number(worldState.max_health):skeleton.maxHealth;
      skeleton.defeated=Boolean(worldState.defeated);
      if(tookDamage&&(source!=='snapshot'||hadServerState)) {
        // O servidor já aplicou o dano e o deslocamento; reproduzimos o impacto
        // confirmado na tela sem calcular dano nem mover o inimigo localmente.
        startKnockback(skeleton,{
          x:Math.sign(nextX-previousX),
          y:Math.sign(nextY-previousY)
        });
        skeleton.attacking=false;
        skeleton.attackElapsed=0;
        skeleton.remoteAttacking=false;
      }
      const attackStartedAt=String(worldState.attack_started_at||'');
      if(attackStartedAt&&attackStartedAt!==skeleton.lastServerAttackStartedAt) {
        skeleton.lastServerAttackStartedAt=attackStartedAt;
        skeleton.remoteAttackDirection=Number.isFinite(Number(worldState.direction))?Number(worldState.direction):2;
        skeleton.remoteAttackElapsed=0;
        skeleton.remoteAttacking=true;
      }
      refreshSkeletonCombatStats();
      return true;
    }
    return false;
  }
  function applyWorldState(snapshot) {
    if(!snapshot||typeof snapshot!=='object') return false;
    const rows=Array.isArray(snapshot.entities)?snapshot.entities:[];
    // Uma fotografia RPC pode ter sido iniciada antes de um evento Realtime.
    // Deletes explícitos e revisões por entidade são a fonte de verdade; uma
    // fotografia antiga nunca remove uma entidade que acabou de chegar.
    rows.forEach(row=>applyWorldEntity(row,'snapshot'));
    if(!crownRealtimeSeen) {
      kingCrownClaimedBy=snapshot.world?.king_user_id?String(snapshot.world.king_user_id):null;
    }
    remotePlayers.forEach((remote,id)=>{
      remote.isKing=Boolean(kingCrownClaimedBy&&String(id)===String(kingCrownClaimedBy));
      remote.hasKingCrown=remote.isKing;
    });
    updateKingStatus();
    return true;
  }

  function updateSkeletonStatsPosition(width,height) {
    const panel=document.getElementById('skeleton-stats');
    const skeleton=window.KTKEnemySkeleton.entity;
    refreshSkeletonCombatStats();
    if(skeleton.defeated||!gameStarted||!screens.game.classList.contains('active')||!isNearLocalPlayer(skeleton)) {
      panel.classList.remove('is-visible');
      return;
    }
    const screenX=skeleton.x-camera.x*width+width/2;
    const screenY=skeleton.y-camera.y*height+height/2-(skeleton.knockbackHeight||0);
    if(screenX < -50 || screenX > width+50 || screenY < -50 || screenY > height+50) {
      panel.classList.remove('is-visible');
      return;
    }
    const canvasRect=canvas.getBoundingClientRect();
    const x=Math.max(82,Math.min(window.innerWidth-82,canvasRect.left+screenX));
    const y=Math.max(92,canvasRect.top+screenY-48);
    panel.style.left=x+'px';
    panel.style.top=y+'px';
    panel.classList.add('is-visible');
  }
