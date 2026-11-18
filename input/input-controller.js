/* Controles de teclado, mouse e inicialização do ciclo de jogo. */
'use strict';

  const MOVEMENT_KEYS = new Set(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright']);

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
      startPunch();
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
      sendImmediateMovementIntent();
    }
  });
  document.querySelectorAll('.inventory-slot:not(.is-locked)').forEach(slot=>{
    slot.tabIndex=0;
    slot.setAttribute('role','button');
    slot.addEventListener('click',()=>selectInventorySlot(Number(slot.dataset.slot)));
    slot.addEventListener('dragstart',event=>{
      const index=Number(slot.dataset.slot);
      const item=inventory[index];
      if(event.button!==0||!item?.wearSlot) {
        event.preventDefault();
        return;
      }
      draggedWearableIndex=index;
      slot.classList.add('is-dragging');
      if(event.dataTransfer) {
        event.dataTransfer.effectAllowed='move';
        event.dataTransfer.setData('text/plain',String(index));
      }
    });
    slot.addEventListener('dragend',()=>{
      draggedWearableIndex=-1;
      slot.classList.remove('is-dragging');
      document.querySelectorAll('.wearable-slot').forEach(target=>target.classList.remove('is-drop-target'));
    });
    slot.addEventListener('keydown',event=>{
      if(event.key==='Enter'||event.key===' ') {
        event.preventDefault();
        selectInventorySlot(Number(slot.dataset.slot));
      }
    });
  });
  document.querySelectorAll('.wearable-slot').forEach(slot=>{
    slot.addEventListener('dragover',event=>{
      if(draggedWearableIndex<0) return;
      event.preventDefault();
      const item=inventory[draggedWearableIndex];
      slot.classList.toggle('is-drop-target',item?.wearSlot===slot.dataset.wearSlot);
      if(event.dataTransfer) event.dataTransfer.dropEffect='move';
    });
    slot.addEventListener('dragleave',()=>slot.classList.remove('is-drop-target'));
    slot.addEventListener('drop',event=>{
      event.preventDefault();
      if(draggedWearableIndex>=0) {
        suppressWearSlotClick=true;
        setTimeout(()=>{suppressWearSlotClick=false;},0);
        equipWearableFromInventory(draggedWearableIndex,slot.dataset.wearSlot);
      }
      draggedWearableIndex=-1;
      slot.classList.remove('is-drop-target');
    });
    slot.addEventListener('click',()=>{
      if(suppressWearSlotClick) return;
      unequipWearable(slot.dataset.wearSlot);
    });
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
    if(hadMovementIntent) sendImmediateMovementIntent();
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