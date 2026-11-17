/* Entrada, saída, morte e reinicialização do personagem. */
'use strict';

  function clearClientWorldReplica() {
    // Descarta somente cópias de renderização/estado recebidas do servidor.
    // Nenhuma dessas estruturas é usada para persistir ou decidir o mundo.
    playerDead=true;
    newCharacterRequired=true;
    gameStarted=false;
    keys.clear();
    playerInputX=0; playerInputY=0; playerMoving=false; playerRunning=false;
    rightMouseHeld=false;
    shieldStaminaExhausted=false;
    remotePlayers.clear();
    remoteLayerCache.clear();
    serverWorldEntities.clear();
    serverEntityRevisions.clear();
    worldItems.clear();
    crownRealtimeSeen=false;
    kingCrownClaimedBy=null;
    inventory.fill(null);
    wearableSlotOrder.forEach(slot=>{equippedWearables[slot]=null;});
    selectedInventorySlot=0;
    lastServerInventorySignature=null;
    lastServerWearablesSignature=null;
    lastServerSelectedSlot=null;
    player.x=0; player.y=0; player.direction=2;
    player.knockback=null; player.knockbackHeight=0;
    playerVisual.x=0; playerVisual.y=0;
    playerVisual.targetX=0; playerVisual.targetY=0;
    playerVisual.initialized=false;
    camera.x=0; camera.y=0;
    walkTime=0; idleTime=0;
    punch.active=false; punch.elapsed=0; punch.cooldown=0;
    punch.hitApplied=false; punch.weaponAttack=false; punch.weaponItem=null;
    boomerangProjectile.active=false;
    arrowProjectile.active=false;
    stoneProjectile.active=false;
    magicProjectile.active=false;
    const skeleton=window.KTKEnemySkeleton?.entity;
    if(skeleton) {
      skeleton.lastServerRevision=0;
      skeleton.attacking=false;
      skeleton.attackElapsed=0;
      skeleton.attackHitApplied=false;
      skeleton.knockback=null;
      skeleton.knockbackHeight=0;
    }
    equipmentCatalog?.items?.forEach(item=>{if(item) item.collected=false;});
    Object.assign(character,{
      gender:'male',skin:'brown',eyes:'brown',hairstyle:'hair_pixie',
      hair:'dark_brown',beard:'none',mustache:'none'
    });
    window.KTKPlayerStats?.resetForNewCharacter?.();
    equipStartingWearables();
    renderInventory();
    renderWearableSlots();
    rebuildCharacterLayers();
    setRemotePlayers([]);
    updateKingStatus();
  }

  function handlePlayerDeath(serverConfirmed=false) {
    if(playerDead) return;
    playerDead=true;
    newCharacterRequired=true;
    keys.clear();
    playerInputX=0; playerInputY=0; playerMoving=false; playerRunning=false;
    rightMouseHeld=false;
    shieldStaminaExhausted=false;
    punch.active=false;
    player.knockback=null;
    player.knockbackHeight=0;

    clearClientWorldReplica();
    document.getElementById('enter-world').textContent='Criar novo personagem';
    showScreen('death');
    // mark_dead agora é idempotente: o servidor já descartou o personagem quando esta confirmação chega.
    void window.KTKOnline?.markDead?.();
    updateKingStatus();
  }

var  startingGame = false;
var  leavingGame = false;

  async function startGame() {
    const button=document.getElementById('enter-world');
    if(startingGame) return;
    startingGame=true;
    if(button) {
      button.disabled=true;
      button.dataset.previousText=button.textContent;
      button.textContent='Conectando ao mundo…';
      button.style.opacity='.7';
      button.style.cursor='wait';
    }
    try {
      if(!window.KTKOnline) {
        toast('O módulo online não carregou. Atualize a página e tente novamente.');
        return;
      }
      const onlineResult=await window.KTKOnline.enter({
        displayName:document.getElementById('ktk-display-name')?.value||'',
        character:{...character},
        newCharacter:newCharacterRequired
      });
      if(!onlineResult.ok) {
        toast(onlineResult.error||'Não foi possível entrar no mundo online.');
        if(onlineResult.dead) {
          playerDead=true;
          newCharacterRequired=true;
          showScreen('death');
        }
        return;
      }

      const onlinePlayer=onlineResult.player;
      if(onlinePlayer?.state) applyServerState(onlinePlayer.state);
      const serverSpawnX=Number(onlinePlayer?.x);
      const serverSpawnY=Number(onlinePlayer?.y);
      const serverSpawnDirection=Number(onlinePlayer?.direction);
      if(Number.isFinite(serverSpawnX)&&Number.isFinite(serverSpawnY)) {
        window.KTKWorldEntities?.setLocalState?.(
          serverSpawnX,serverSpawnY,
          Number.isFinite(serverSpawnDirection)?serverSpawnDirection:2
        );
      }
      if(newCharacterRequired) {
        // Os equipamentos e atributos iniciais já foram confirmados pelo servidor.
        player.knockback=null; player.knockbackHeight=0;
        camera.x=0; camera.y=0; walkTime=0; idleTime=0;
        keys.clear();
        rightMouseHeld=false;
        shieldStaminaExhausted=false;
        punch.active=false; punch.elapsed=0; punch.cooldown=0; punch.hitApplied=false; punch.weaponAttack=false; punch.weaponItem=null;
        boomerangProjectile.active=false;
        arrowProjectile.active=false;
        stoneProjectile.active=false;
        magicProjectile.active=false;
        const enemy=window.KTKEnemySkeleton?.entity;
        if(enemy) {
          enemy.attacking=false; enemy.attackElapsed=0; enemy.attackHitApplied=false; enemy.attackCooldown=0.5;
        }
        playerInputX=0; playerInputY=0;
        playerMoving=false; playerRunning=false;
        playerDead=false;
        newCharacterRequired=false;
        gameStarted=true;
        renderInventory();
        rebuildCharacterLayers();
        toast('Novo personagem criado. Boa exploração!');
      } else if(!gameStarted) {
        gameStarted=true;
        camera.x=0; camera.y=0; walkTime=0;
        toast('Você chegou ao mundo. Explore à vontade!');
      } else {
        toast('Aparência atualizada. Boa exploração!');
      }

      if(button) button.textContent='Entrar no mundo →';
      showScreen('game');

      updateKingStatus();
    } catch(error) {
      console.error('KTK startGame:',error);
      toast('O personagem conectou, mas houve um erro ao preparar o jogo. Tente entrar novamente.');
    } finally {
      startingGame=false;
      if(button) {
        button.disabled=false;
        button.style.opacity='';
        button.style.cursor='';
        if(button.textContent==='Conectando ao mundo…') button.textContent=button.dataset.previousText||'Entrar no mundo →';
      }
    }
  }

  async function leaveGameToCreator() {
    if(leavingGame || startingGame || !gameStarted || !screens.game.classList.contains('active')) return;
    leavingGame=true;
    keys.clear();
    playerInputX=0; playerInputY=0; playerMoving=false; playerRunning=false;
    rightMouseHeld=false;
    shieldStaminaExhausted=false;

    const button=document.getElementById('enter-world');
    const previousText=button?.textContent||'Entrar no mundo →';
    if(button) {
      button.disabled=true;
      button.textContent='Encerrando personagem…';
    }

    try {
      const result=await window.KTKOnline?.leaveWorld?.();
      if(!result?.ok) throw new Error(result?.error||'O servidor não confirmou a saída.');

      // Esc encerra a vida atual. A próxima entrada obrigatoriamente cria
      // outra identidade anônima e recebe estado inicial no servidor.
      clearClientWorldReplica();
      playerDead=true;
      newCharacterRequired=true;
      gameStarted=false;
      if(button) button.textContent='Criar novo personagem';
      showScreen('creator');
      updateCreator();
      toast('Você saiu do mundo. Seu personagem morreu; a próxima entrada começará do zero.');
    } catch(error) {
      console.error('KTK leaveGameToCreator:',error);
      toast(error?.message||'Não foi possível encerrar o personagem. Tente novamente.');
    } finally {
      leavingGame=false;
      if(button) {
        button.disabled=false;
        if(newCharacterRequired) button.textContent='Criar novo personagem';
        else button.textContent=previousText;
      }
    }
  }

  function toast(message) {
    const el=document.getElementById('toast');
    el.textContent=message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>el.classList.remove('show'),2600);
  }

  document.getElementById('back-welcome').addEventListener('click',()=>showScreen('welcome'));
  document.getElementById('enter-world').addEventListener('click',startGame);
  document.getElementById('create-new-character').addEventListener('click',()=>{
    document.getElementById('enter-world').textContent='Criar novo personagem';
    showScreen('creator');
    updateCreator();
  });
  document.getElementById('edit-character').addEventListener('click',()=>{
    document.getElementById('enter-world').textContent='Voltar ao mundo →';
    showScreen('creator');
    updateCreator();
  });

  document.querySelectorAll('[data-gender]').forEach(btn=>btn.addEventListener('click',()=>{
    character.gender=btn.dataset.gender;
    updateCreator();
  }));
  document.getElementById('hairstyle-select').addEventListener('change',event=>{
    character.hairstyle=event.target.value;
    updateCreator();
  });
  document.getElementById('beard-select').addEventListener('change',event=>{
    character.beard=event.target.value;
    updateCreator();
  });
  document.getElementById('mustache-select').addEventListener('change',event=>{
    character.mustache=event.target.value;
    updateCreator();
  });
