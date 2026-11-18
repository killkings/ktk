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
    playerVisual.direction=2;
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

  // O script de entrada é clássico e pode executar antes de o grafo ESM do
  // multiplayer terminar de carregar. Aguarda o sinal do módulo em vez de
  // rejeitar o primeiro clique por uma corrida de carregamento.
  function waitForOnlineModule(timeoutMs=15000) {
    if(typeof window.KTKOnline?.enter==='function') return Promise.resolve(window.KTKOnline);
    return new Promise((resolve,reject)=>{
      let timeoutId=null;
      const cleanup=()=>{
        window.removeEventListener('ktk-online-ready',onReady);
        if(timeoutId!==null) clearTimeout(timeoutId);
      };
      const onReady=()=>{
        const online=window.KTKOnline;
        if(typeof online?.enter!=='function') return;
        cleanup();
        resolve(online);
      };
      window.addEventListener('ktk-online-ready',onReady);
      timeoutId=setTimeout(()=>{
        cleanup();
        reject(new Error('O módulo online não carregou. Verifique a conexão e recarregue a página.'));
      },timeoutMs);
      onReady();
    });
  }

  async function startGame() {
    const button=document.getElementById('enter-world');
    const nameInput=document.getElementById('ktk-display-name');
    const displayName=String(nameInput?.value||'').trim().slice(0,24);
    if(startingGame) return;
    if(displayName.length<2) {
      toast('Digite um nome com pelo menos 2 caracteres para entrar no mundo.');
      nameInput?.focus();
      return;
    }

    startingGame=true;
    let gameScreenOpened=false;
    if(button) {
      button.disabled=true;
      button.dataset.previousText=button.textContent;
      button.textContent='Conectando ao mundo…';
      button.style.opacity='.7';
      button.style.cursor='wait';
    }

    try {
      const online=await waitForOnlineModule();
      const onlineResult=await online.enter({
        displayName,
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
      const playerNameLabel=document.getElementById('player-name');
      if(playerNameLabel) playerNameLabel.textContent=displayName;
      const isNewCharacter=Boolean(newCharacterRequired);
      const wasAlreadyPlaying=Boolean(gameStarted);

      if(isNewCharacter) {
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
      } else if(!wasAlreadyPlaying) {
        camera.x=0; camera.y=0; walkTime=0; idleTime=0;
      }

      // A conexão e a posição já foram confirmadas pelo servidor. Mostra o
      // mundo antes de hidratar inventário e sprites, que são etapas visuais.
      playerDead=false;
      newCharacterRequired=false;
      gameStarted=true;
      if(button) button.textContent='Entrar no mundo →';
      showScreen('game');
      gameScreenOpened=screens.game.classList.contains('active');
      if(!gameScreenOpened) throw new Error('Não foi possível abrir a tela do mundo.');

      let visualPreparationFailed=false;
      try {
        const serverSpawnX=Number(onlinePlayer?.x);
        const serverSpawnY=Number(onlinePlayer?.y);
        const serverSpawnDirection=Number(onlinePlayer?.direction);
        if(Number.isFinite(serverSpawnX)&&Number.isFinite(serverSpawnY)) {
          window.KTKWorldEntities?.setLocalState?.(
            serverSpawnX,serverSpawnY,
            Number.isFinite(serverSpawnDirection)?serverSpawnDirection:2
          );
          window.KTKOnline?.sendPosition?.(true);
        }
      } catch(error) {
        visualPreparationFailed=true;
        console.error('KTK initial spawn rendering:',error);
      }

      try {
        if(onlinePlayer?.state) applyServerState(onlinePlayer.state);
      } catch(error) {
        visualPreparationFailed=true;
        console.error('KTK initial state rendering:',error);
      }

      try {
        renderInventory();
      } catch(error) {
        visualPreparationFailed=true;
        console.error('KTK initial inventory rendering:',error);
      }

      void rebuildCharacterLayers().catch(error=>{
        console.error('KTK initial character appearance:',error);
      });

      try {
        updateKingStatus();
      } catch(error) {
        visualPreparationFailed=true;
        console.error('KTK initial king status rendering:',error);
      }

      if(visualPreparationFailed) {
        toast('Você entrou no mundo, mas parte da interface não foi carregada.');
      } else if(isNewCharacter) {
        toast('Novo personagem criado. Boa exploração!');
      } else if(!wasAlreadyPlaying) {
        toast('Você chegou ao mundo. Explore à vontade!');
      } else {
        toast('Aparência atualizada. Boa exploração!');
      }
    } catch(error) {
      console.error('KTK startGame:',error);
      const message=String(error?.message||'Não foi possível preparar o jogo. Tente entrar novamente.');
      toast(message.length>180?message.slice(0,177)+'…':message);
    } finally {
      startingGame=false;
      if(button) {
        button.disabled=false;
        button.style.opacity='';
        button.style.cursor='';
        button.textContent=gameScreenOpened
          ? 'Entrar no mundo →'
          : (button.dataset.previousText||'Entrar no mundo →');
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
