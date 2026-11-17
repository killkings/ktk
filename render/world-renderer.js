/* Renderização do mundo, câmera, terreno e loop visual. */
'use strict';

  function drawPreview() {
    pctx.clearRect(0,0,preview.width,preview.height);
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

  function hash2(x,y) {
    let n = Math.imul(x ^ 0x9e3779b9,0x85ebca6b) ^ Math.imul(y ^ 0xc2b2ae35,0x27d4eb2f);
    n = Math.imul(n ^ (n >>> 16),0x7feb352d);
    n = Math.imul(n ^ (n >>> 15),0x846ca68b);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  }

var  grassTileCache = new Map();
  function makeGrassTile(tx,ty) {
    const key = `${tx},${ty}`;
    if (grassTileCache.has(key)) return grassTileCache.get(key);
    const tile = document.createElement('canvas');
    tile.width=TILE; tile.height=TILE;
    const t=tile.getContext('2d');
    const seed=hash2(tx,ty);
    t.fillStyle='#67964f'; t.fillRect(0,0,TILE,TILE);
    const shade=Math.floor(seed*11);
    t.fillStyle=`rgba(${24+shade},${76+shade},${31+Math.floor(shade*.45)},${0.025+seed*.035})`;
    t.fillRect(0,0,TILE,TILE);
    const count=11+Math.floor(seed*10);
    for(let i=0;i<count;i++) {
      const r1=hash2(tx*31+i*7,ty*19-i*13);
      const r2=hash2(tx*17-i*11,ty*29+i*5);
      const x=5+r1*(TILE-10);
      const y=5+r2*(TILE-10);
      const len=3.5+hash2(tx+i,ty-i)*5.5;
      const lean=(hash2(tx-i*3,ty+i*2)-.5)*5;
      t.lineWidth=1+r1*.45;
      t.lineCap='round';
      t.strokeStyle=r2>.52?'rgba(31,91,42,.31)':'rgba(202,224,135,.25)';
      t.beginPath(); t.moveTo(x,y+len*.35); t.quadraticCurveTo(x+lean*.25,y-len*.2,x+lean,y-len); t.stroke();
      if(i%4===0) {
        t.strokeStyle='rgba(219,231,160,.19)'; t.lineWidth=.8;
        t.beginPath(); t.moveTo(x-2,y+1); t.lineTo(x-2.8,y-len*.48); t.stroke();
      }
    }
    if(seed>.72) {
      t.fillStyle='rgba(190,214,125,.035)';
      t.beginPath(); t.ellipse(TILE*.5,TILE*.5,18+seed*10,12+seed*8,seed*2,0,Math.PI*2); t.fill();
    }
    grassTileCache.set(key,tile);
    if(grassTileCache.size>1200) grassTileCache.delete(grassTileCache.keys().next().value);
    return tile;
  }

  function drawGrass(g,left,top,width,height) {
    g.fillStyle='#67964f'; g.fillRect(0,0,width,height);
    const minX=Math.floor(left/TILE)-1;
    const maxX=Math.floor((left+width)/TILE)+1;
    const minY=Math.floor(top/TILE)-1;
    const maxY=Math.floor((top+height)/TILE)+1;
    for(let ty=minY;ty<=maxY;ty++) {
      for(let tx=minX;tx<=maxX;tx++) g.drawImage(makeGrassTile(tx,ty),tx*TILE-left,ty*TILE-top);
    }
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
      updateRemotePlayerMotion(dt);
      if(window.KTKWorldMap) window.KTKWorldMap.setViewport(w,h);

      // camera.x/y identificam a sala. O retângulo desenhado é sempre uma tela 16:9.
      const camX=camera.x*w-w/2;
      const camY=camera.y*h-h/2;
      if(window.KTKWorldMap && typeof window.KTKWorldMap.draw==='function') {
        window.KTKWorldMap.draw(ctx,camX,camY,w,h,window.KTKWorldMap.tileSize);
      } else {
        drawGrass(ctx,camX,camY,w,h);
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
          const direction=punch.active?punch.direction:player.direction;
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
      ctx.fillStyle='#67964f';
      ctx.fillRect(0,0,w,h);
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
    serverWorldEntities.forEach(entity=>{
      entity.elapsed=(entity.elapsed||0)+Math.max(0,deltaSeconds);
      const dx=(Number(entity.targetX)||0)-(Number(entity.x)||0);
      const dy=(Number(entity.targetY)||0)-(Number(entity.y)||0);
      const distance=Math.hypot(dx,dy);
      if(distance>0.05) {
        const blend=Math.min(1,1-Math.exp(-Math.max(0,deltaSeconds)*14));
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
      // O cliente lê apenas a intenção. Não altera coordenadas, direção oficial
      // nem colisões: o próximo estado de posição chega do RPC do servidor.
      walkTime+=dt;
    } else {
      walkTime=0;
    }
    updateKnockbacks(dt);
    updateEnemyCombat(dt);
  }
