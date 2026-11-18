/* Controles de teclado, mouse e inicialização do ciclo de jogo. */
'use strict';

  function refreshLocalMovementInput() {
    let dx=0,dy=0;
    if(keys.has('w')||keys.has('arrowup')) dy-=1;
    if(keys.has('s')||keys.has('arrowdown')) dy+=1;
    if(keys.has('a')||keys.has('arrowleft')) dx-=1;
    if(keys.has('d')||keys.has('arrowright')) dx+=1;
    playerInputX=dx;
    playerInputY=dy;
    playerMoving=dx!==0||dy!==0;
  }

  window.addEventListener('keydown',event=>{
    const key=event.key.toLowerCase();
    if(['arrowup','arrowdown','arrowleft','arrowright',' '].includes(key)) event.preventDefault();
    if(key==='escape'&&!event.repeat&&gameStarted&&screens.game.classList.contains('active')) {
      event.preventDefault();
      void leaveGameToCreator();
      return;
    }
    if(screens.game.classList.contains('active')) {
      const wasPressed=keys.has(key);
      keys.add(key);
      if(!wasPressed) {
        refreshLocalMovementInput();
      }
      if(key==='e'&&!event.repeat) interactWithSelectedItem();
      if(key==='n'&&!event.repeat) { event.preventDefault(); void expandInventorySlot(); }
      if((key==='1'||key==='2')&&!event.repeat) selectInventorySlot(Number(key)-1);
      if(key==='m'&&!event.repeat) {
        void window.KTKOnline?.gameAction?.('magic_level',{}).then(result=>{
          const level=Number(result?.state?.magic_level)||0;
          const maxLevel=window.KTKPlayerStats.stats.magicLevel.max;
          toast(`Nível mágico: ${level}/${maxLevel}.`);
        }).catch(error=>toast(error?.message||'O servidor não alterou o nível mágico.'));
      }
    }
  },{passive:false});
  window.addEventListener('keyup',event=>{
    const key=event.key.toLowerCase();
    if(!keys.delete(key)) return;
    refreshLocalMovementInput();
  });
  canvas.addEventListener('mousedown',event=>{
    if(event.button===0) {
      startPunch(event);
    }
    if(event.button===2) {
      event.preventDefault();
      rightMouseHeld=true;
      shieldStaminaExhausted=false;
      window.KTKPlayerStats.render();
    }
  });
  canvas.addEventListener('contextmenu',event=>event.preventDefault());
  window.addEventListener('mouseup',event=>{
    if(event.button===2&&rightMouseHeld) {
      rightMouseHeld=false;
      shieldStaminaExhausted=false;
      window.KTKPlayerStats.render();
    }
  });
  // A mochila não fornece roupas aos espaços de equipamento.
  // Vestimentas só entram nesses espaços quando são coletadas no mapa.
  const inventorySlots=document.querySelector('.inventory-slots');
  inventorySlots?.addEventListener('click',event=>{
    const slot=event.target.closest('.inventory-slot');
    if(!slot||slot.classList.contains('is-locked')) return;
    selectInventorySlot(Number(slot.dataset.slot));
  });
  inventorySlots?.addEventListener('keydown',event=>{
    const slot=event.target.closest('.inventory-slot');
    if(!slot||slot.classList.contains('is-locked')) return;
    if(event.key==='Enter'||event.key===' ') {
      event.preventDefault();
      selectInventorySlot(Number(slot.dataset.slot));
    }
  });
  // Clicar em uma peça vestida retira-a para o mapa; não existe retorno à mochila.
  document.querySelectorAll('.wearable-slot').forEach(slot=>{
    slot.addEventListener('click',()=>unequipWearable(slot.dataset.wearSlot));
  });
  window.addEventListener('blur',()=>{
    keys.clear();
    refreshLocalMovementInput();
    playerRunning=false;
    if(rightMouseHeld) {
      rightMouseHeld=false;
      shieldStaminaExhausted=false;
      window.KTKPlayerStats.render();
    }
  });

  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='hidden') {
      keys.clear();
      refreshLocalMovementInput();
      playerRunning=false;
      rightMouseHeld=false;
      shieldStaminaExhausted=false;
    }
  });
  window.addEventListener('resize',resize);
  updateCreator();
  renderInventory();
  resize();
  requestAnimationFrame(render);