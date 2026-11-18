/* Renderização do mundo, câmera, terreno e loop visual. */
'use strict';

  function drawIdentityPortrait() {
    const portrait=document.getElementById('identity-portrait');
    if(!portrait) return;
    const g=portrait.getContext('2d');
    if(!g) return;
    g.clearRect(0,0,portrait.width,portrait.height);
    if(!currentLayers.length) return;

    const frameCanvas=document.createElement('canvas');
    frameCanvas.width=FRAME_SIZE;
    frameCanvas.height=FRAME_SIZE;
    const frameContext=frameCanvas.getContext('2d');
    if(!frameContext) return;

    drawLayeredCharacter(frameContext,FRAME_SIZE/2,FRAME_SIZE/2,currentLayers,1,2,0);
    g.imageSmoothingEnabled=false;
    g.drawImage(frameCanvas,12,0,40,40,0,0,portrait.width,portrait.height);
  }

  function drawPreview() {
    pctx.clearRect(0,0,preview.width,preview.height);
    drawIdentityPortrait();
    if (!previewLayers.length) {
      pctx.fillStyle = 'rgba(255,255,255,.8)';
      pctx.font = '13px system-ui';
      pctx.textAlign = 'center';
      pctx.fillText('Carregando personagem…',165,168);
      return;
    }
    drawLayeredCharacter(pctx,165,165,previewLayers,PREVIEW_SCALE,2,0);
  }

  function updateCreator() {
    updateCreatorControls();
    rebuildCharacterLayers();
  }

  // API usada pelo botão inicial, cujo listener é registrado antes dos módulos do jogo.
  window.KTKOpenCreator = function KTKOpenCreator() {
    document.getElementById('enter-world').textContent = 'Entrar no mundo →';
    showScreen('creator');
    updateCreator();
  };

  // O controlador delega o terreno alternativo; o desenho fica em módulo próprio.
  function drawGrassFallback(g,left,top,width,height) {
    const fallback = window.KTKGrassFallback;
    if (fallback && typeof fallback.draw === 'function') {
      fallback.draw(g,left,top,width,height);
      return;
    }
    g.fillStyle='#67964f';
    g.fillRect(0,0,width,height);
  }

  function resize() {
    const rect=canvas.getBoundingClientRect();
    dpr=Math.min(window.devicePixelRatio||1,2);
    canvas.width=Math.max(1,Math.floor(rect.width*dpr));
    canvas.height=Math.max(1,Math.floor(rect.height*dpr));
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }

  function render(now) {
    // Agenda o próximo frame antes do desenho: uma falha isolada não congela o jogo.
    requestAnimationFrame(render);
    const w=canvas.clientWidth, h=canvas.clientHeight;
    if(!w||!h) return;
    const dt=Math.min((now-lastTime)/1000||0,.04);
    lastTime=now;
    const inWorld=gameStarted&&screens.game.classList.contains('active');
    ctx.clearRect(0,0,w,h);
    if(!inWorld) return;

    try {
      update(dt,w,h);
      updateLocalPlayerVisual(dt);
      window.KTKOnline?.sendPosition?.();
      updateRemotePlayerMotion(dt);
      if(window.KTKWorldMap) window.KTKWorldMap.setViewport(w,h);

      // camera.x/y identificam a sala. O retângulo desenhado é sempre uma tela 16:9.
      const camX=camera.x*w-w/2;
      const camY=camera.y*h-h/2;
      if(window.KTKWorldMap && typeof window.KTKWorldMap.draw==='function') {
        window.KTKWorldMap.draw(ctx,camX,camY,w,h,window.KTKWorldMap.tileSize);
      } else {
        drawGrassFallback(ctx,camX,camY,w,h);
      }

      const attackFrameCount=Math.max(1,Number(punch.weaponItem?.attackFrameCount)||6);
      const frame=punch.active
        ? Math.min(attackFrameCount-1,Math.floor((punch.elapsed/PUNCH_ANIMATION_SECONDS)*attackFrameCount))
        : playerMoving?Math.floor(walkTime*10)%WALK_COLUMNS:Math.floor(idleTime*2)%IDLE_COLUMNS;
      const renderables=[
        ...getWorldEntities().map(entity=>({entity,depth:entity.y})),
        {entity:{type:'local-player'},depth:camera.y*h+playerVisual.y}
      ].sort((a,b)=>a.depth-b.depth);
      const playerWorldX=camera.x*w+player.x;
      const playerWorldY=camera.y*h+player.y;
      let focusedItem=null;
      let focusedItemDistance=NEARBY_INFO_RADIUS;
      worldItems.forEach(item=>{
        if(item.collected) return;
        const distance=Math.hypot(playerWorldX-item.x,playerWorldY-item.y);
        if(distance<focusedItemDistance) {
          focusedItemDistance=distance;
          focusedItem=item;
        }
      });
      renderables.forEach(({entity})=>{
        const localPlayer=entity.type==='local-player';
        const screenX=localPlayer?playerVisual.x+w/2:entity.x-camera.x*w+w/2;
        const screenY=localPlayer?playerVisual.y+h/2:entity.y-camera.y*h+h/2;
        if(entity.type==='local-player'||entity.type==='player') drawGroundShadow(ctx,screenX,screenY+33,17,7,.34);
        else if(entity.type==='enemy') drawGroundShadow(ctx,screenX,screenY+33,18,7,.36);
        else if(entity.type==='item') drawGroundShadow(ctx,screenX,screenY+15,14,5,.28);
        if(entity.type==='local-player') {
          const weaponAttackLayers=punch.weaponItem?.attackType==='thrust'
            ? thrustLayers
            : punch.weaponItem?.attackType==='shoot'?shootLayers:slashLayers;
          const baseLayers=punch.active
            ? (punch.weaponAttack
              ? (weaponAttackLayers.length?weaponAttackLayers:currentLayers)
              : (punchLayers.length?punchLayers:currentLayers))
            : playerMoving?(playerRunning?runLayers:currentLayers):idleLayers;
          const bodyFrameLayer=baseLayers.find(layer=>layer.definition?.name==='corpo')||baseLayers[0];
          const bodyFrameSize=bodyFrameLayer?.frameSize||FRAME_SIZE;
          const bodyImageWidth=bodyFrameLayer?.image?.naturalWidth||bodyFrameLayer?.image?.width||bodyFrameSize;
          const bodyFrameColumns=Math.max(1,Math.floor(bodyImageWidth/bodyFrameSize));
          const direction=punch.active?punch.direction:(playerMoving?playerVisual.direction:player.direction);
          let weaponMode=punch.active?(punch.weaponAttack?'attack':'none'):'held';
          if(boomerangProjectile.active&&inventory[selectedInventorySlot]===boomerangProjectile.item) weaponMode='none';
          drawLayeredCharacter(ctx,screenX,screenY-(player.knockbackHeight||0),getPlayerLayers(baseLayers,weaponMode),WORLD_SCALE,direction,frame,Boolean(player.knockback),bodyFrameColumns);
          return;
        }
        if(entity.type==='enemy' && entity.id==='skeleton-1') {
          window.KTKEnemySkeleton.draw(ctx,screenX,screenY,idleTime);
        } else if(entity.type==='enemy' && entity.layers) {
          drawLayeredCharacter(ctx,screenX,screenY-(entity.knockbackHeight||0),entity.layers,WORLD_SCALE,Number.isFinite(entity.direction)?entity.direction:2,entity.frame||0,Boolean(entity.knockback));
          drawNearbyEntityStats(ctx,entity,screenX,screenY);
        } else if(entity.type==='item') {
          if(entity.id==='longsword-1') window.KTKWorldSword.draw(ctx,screenX,screenY);
          else drawWorldItem(ctx,entity,screenX,screenY);
          if(entity===focusedItem) drawWorldItemLabel(ctx,entity,screenX,screenY);
        } else if(entity.type==='resource') {
          drawResourceEntity(ctx,entity,screenX,screenY);
        } else if(entity.type==='player') {
          const attack=entity.attackAnimation;
          const attackElapsed=attack?(performance.now()-attack.startedAt)/1000:Infinity;
          const attackActive=Boolean(attack&&attackElapsed>=0&&attackElapsed<attack.duration);
          if(attack&&!attackActive&&attackElapsed>=attack.duration) entity.attackAnimation=null;
          const attackBase=attackActive
            ? (entity.attackLayers?.[attack.type]?.length?entity.attackLayers[attack.type]:entity.attackLayers?.slash)
            : null;
          const remoteLayers=attackBase?.length
            ? getRemotePlayerAttackLayers(attackBase,attack)
            : entity.moving&&entity.walkLayers?.length?entity.walkLayers:(entity.idleLayers?.length?entity.idleLayers:entity.layers);
          const remoteFrame=attackActive
            ? Math.min(attack.frameCount-1,Math.floor(attackElapsed/attack.duration*attack.frameCount))
            : entity.moving?Math.floor((entity.walkTime||0)*10)%WALK_COLUMNS:0;
          const remoteDirection=attackActive?attack.direction:entity.direction;
          const bodyLayer=remoteLayers?.find(layer=>layer.definition?.name==='corpo')||remoteLayers?.[0];
          const bodySize=bodyLayer?.frameSize||FRAME_SIZE;
          const bodyWidth=bodyLayer?.image?.naturalWidth||bodyLayer?.image?.width||bodySize;
          const bodyColumns=Math.max(1,Math.floor(bodyWidth/bodySize));
          drawLayeredCharacter(ctx,screenX,screenY-(entity.knockbackHeight||0),remoteLayers,WORLD_SCALE,remoteDirection,remoteFrame,Boolean(entity.knockback),attackActive?bodyColumns:0);
          drawNearbyEntityStats(ctx,entity,screenX,screenY);
        } else if(entity.type==='remote-projectile') {
          drawRemoteProjectile(ctx,screenX,screenY,entity);
        } else if(entity.type==='boomerang-projectile') {
          drawBoomerangProjectile(ctx,screenX,screenY);
        } else if(entity.type==='arrow-projectile') {
          drawArrowProjectile(ctx,screenX,screenY);
        } else if(entity.type==='stone-projectile') {
          drawStoneProjectile(ctx,screenX,screenY);
        } else if(entity.type==='magic-projectile') {
          drawMagicProjectile(ctx,screenX,screenY);
        }
      });
      updateSkeletonStatsPosition(w,h);

      const region=window.KTKWorldMap?.regionAt(camera.x*w+player.x,camera.y*h+player.y);
      document.getElementById('coords').textContent=region
        ? `${region.name} · ${region.subregion} · X${region.x} Y${region.y}`
        : `Sala X${camera.x+1} Y${camera.y+1}`;
    } catch(error) {
      console.error('Erro ao desenhar o mapa do Kill the King:',error);
      // Fallback visível para que um erro no mapa nunca deixe a tela totalmente vazia.
      ctx.save();
      try {
        drawGrassFallback(ctx,camera.x*w-w/2,camera.y*h-h/2,w,h);
      } catch(fallbackError) {
        ctx.fillStyle='#67964f';
        ctx.fillRect(0,0,w,h);
        console.error('Falha no fallback do terreno:',fallbackError);
      }
      ctx.fillStyle='rgba(15,34,24,.82)';
      ctx.fillRect(18,72,Math.min(w-36,540),58);
      ctx.fillStyle='#ffffff';
      ctx.font='bold 14px system-ui';
      ctx.fillText('Falha ao desenhar o mapa. Consulte o console (F12).',30,105);
      ctx.restore();
      document.getElementById('coords').textContent='Erro no mapa — veja o console';
    }
  }

  function updateServerWorldEntities(deltaSeconds) {
    const delta=Math.max(0,Number(deltaSeconds)||0);
    serverWorldEntities.forEach((entity,id)=>{
      entity.elapsed=(entity.elapsed||0)+delta;

      // Projéteis são animados localmente entre as confirmações do servidor.
      // O deslocamento visual é preditivo; colisão e dano continuam no banco.
      if(entity.type==='remote-projectile'&&entity.phase==='outbound') {
        const maxDistance=Math.max(1,Number(entity.maxDistance)||160);
        const serverDistance=Math.max(0,Number(entity.serverDistance)||0);
        entity.distance=Math.max(Number(entity.distance)||0,serverDistance);
        const remaining=Math.max(0,maxDistance-entity.distance);
        const step=Math.min(Math.max(1,Number(entity.speed)||600)*delta,remaining);
        entity.distance+=step;
        const originX=Number.isFinite(entity.originX)?entity.originX:Number(entity.x)||0;
        const originY=Number.isFinite(entity.originY)?entity.originY:Number(entity.y)||0;
        const vectorX=Number(entity.vectorX)||0;
        const vectorY=Number(entity.vectorY)||0;
        entity.x=originX+vectorX*entity.distance;
        entity.y=originY+vectorY*entity.distance;
        if(entity.distance>=maxDistance&&entity.elapsed>(maxDistance/Math.max(1,Number(entity.speed)||600))+0.35) {
          serverWorldEntities.delete(id);
        }
        return;
      }

      const dx=(Number(entity.targetX)||0)-(Number(entity.x)||0);
      const dy=(Number(entity.targetY)||0)-(Number(entity.y)||0);
      const distance=Math.hypot(dx,dy);
      if(distance>0.05) {
        const blend=Math.min(1-Math.exp(-delta*14),1);
        entity.x+=dx*blend;
        entity.y+=dy*blend;
      }
    });
  }

  function update(dt,roomWidth,roomHeight) {
    if(playerDead) return;
    updateServerWorldEntities(dt);
    const currentHealth=playerStats?.stats?.health;
    if(currentHealth&&currentHealth.value<=currentHealth.min) {
      handlePlayerDeath();
      return;
    }
    idleTime+=dt;
    updatePunch(dt);
    let dx=0,dy=0;
    if(keys.has('w')||keys.has('arrowup')) dy-=1;
    if(keys.has('s')||keys.has('arrowdown')) dy+=1;
    if(keys.has('a')||keys.has('arrowleft')) dx-=1;
    if(keys.has('d')||keys.has('arrowright')) dx+=1;
    playerMoving=dx!==0||dy!==0;
    playerInputX=dx;
    playerInputY=dy;
    const shieldHeld=rightMouseHeld && Boolean(getBlockingShield());
    const defending=shieldHeld && !shieldStaminaExhausted;
    const movement=window.KTKPlayerStats.updateStamina(dt,playerMoving,keys.has('shift'),defending);
    window.KTKPlayerStats.updateMana(
      dt,
      playerMoving,
      isMagicWeapon(inventory[selectedInventorySlot]),
      inventory.some(isMagicWeapon)
    );
    if(defending && !movement.shielding) {
      shieldStaminaExhausted=true;
      window.KTKPlayerStats.render();
      toast('Estamina esgotada; solte e pressione novamente para bloquear.');
    }
    playerRunning=movement.running;
    if(playerMoving) {
      // A posição e as colisões já foram atualizadas localmente neste quadro.
      walkTime+=dt;
    } else {
      walkTime=0;
    }
    updateKnockbacks(dt);
    updateEnemyCombat(dt);
  }
