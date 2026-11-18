/* Interface de inventário, vestimentas, coleta e interação. */
'use strict';

  function renderInventory() {
    document.querySelectorAll('.inventory-slot').forEach((slot,index)=>{
      const unlocked=index<inventory.length;
      const selected=unlocked&&index===selectedInventorySlot;
      slot.classList.toggle('is-locked',!unlocked);
      slot.classList.toggle('is-unlocked',unlocked);
      slot.classList.toggle('is-selected',selected);
      slot.setAttribute('aria-pressed',String(selected));
      slot.setAttribute('aria-disabled',String(!unlocked));
      slot.setAttribute('role',unlocked?'button':'presentation');
      slot.tabIndex=unlocked?0:-1;
      const canvas=slot.querySelector('canvas');
      const g=canvas.getContext('2d');
      g.clearRect(0,0,canvas.width,canvas.height);
      const item=unlocked?inventory[index]:null;
      slot.draggable=false;
      const maximum=Math.max(0,Number(item?.maxDurability)||0);
      const remaining=Math.max(0,Number(item?.durability)||0);
      const durabilityPercent=maximum?Math.max(0,Math.min(100,remaining/maximum*100)):0;
      const durabilityFill=slot.querySelector('.slot-durability-meter i');
      slot.classList.toggle('has-durability',Boolean(item&&maximum>0));
      slot.classList.toggle('durability-worn',Boolean(item&&maximum>0&&durabilityPercent<=50&&durabilityPercent>25));
      slot.classList.toggle('durability-low',Boolean(item&&maximum>0&&durabilityPercent<=25));
      if(durabilityFill) durabilityFill.style.setProperty('--fill',`${durabilityPercent}%`);
      const stackCount=item?Math.max(1,Math.floor(Number(item.quantity)||1)):0;
      const quantityBadge=slot.querySelector('.inventory-quantity');
      if(quantityBadge) quantityBadge.textContent=stackCount>1?String(stackCount):'';
      slot.classList.toggle('has-quantity',stackCount>1);
      if(!unlocked) {
        slot.draggable=false;
        slot.title='Bloqueado — pressione N para liberar mais um espaço.';
        slot.setAttribute('aria-label',`Espaço ${index+1} bloqueado`);
        return;
      }
      if(!item) {
        slot.title='Espaço vazio';
        slot.setAttribute('aria-label',`Espaço ${index+1}`);
        return;
      }
      slot.title=describeEquipment(item);
      slot.setAttribute('aria-label',`${item.displayName||'Item'}${stackCount>1?` (${stackCount})`:''}`);
      drawInventoryIcon(g,item);
    });
    renderWearableSlots();
    updateKingStatus();
    window.KTKPlayerStats?.render?.();
  }

  function updateKingStatus() {
    const status=document.getElementById('king-status');
    if(!status) return;
    player.isKing=Boolean(equippedWearables.head?.isKingCrown);
    if(player.isKing) {
      status.textContent='Você é o rei';
      return;
    }
    const remoteKing=[...remotePlayers.values()].find(remote=>remote.isKing||remote.hasKingCrown||remote.wearables?.head?.isKingCrown);
    if(remoteKing) {
      status.textContent=`${remoteKing.displayName||remoteKing.name||'Outro jogador'} é o rei`;
      return;
    }
    const crownOnGround=[...worldItems].some(item=>item.isKingCrown&&!item.collected);
    status.textContent=crownOnGround||!gameStarted?'Coroa Real livre':'Coroa em disputa';
  }

  function getKingCrownItem() {
    return [...worldItems].find(item=>item.isKingCrown)
      || equipmentCatalog?.items?.find(item=>item.isKingCrown)
      || null;
  }

  function syncKingCrownWorldItem(state,x,y) {
    const crown=getKingCrownItem();
    if(!crown) return;
    if(state==='carried') {
      crown.collected=true;
      worldItems.delete(crown);
    } else if(state==='ground') {
      crown.collected=false;
      crown.isStartingWearable=false;
      crown.x=Number.isFinite(Number(x))?Number(x):0;
      crown.y=Number.isFinite(Number(y))?Number(y):0;
      worldItems.add(crown);
    }
    updateKingStatus();
  }

  function selectInventorySlot(index) {
    if(!Number.isInteger(index)||index<0||index>=inventory.length) return;
    void window.KTKOnline?.gameAction?.('select_slot',{slot:index})
      .catch(error=>toast(error?.message||'O servidor não confirmou o espaço selecionado.'));
  }

  async function expandInventorySlot() {
    if(!gameStarted||playerDead||!screens.game.classList.contains('active')) return;
    if(inventory.length>=MAX_INVENTORY_SLOTS) {
      toast('O inventário já tem os 10 espaços disponíveis.');
      return;
    }
    const nextSlot=inventory.length;
    const expand=window.KTKOnline?.expandInventorySlot;
    if(typeof expand!=='function') {
      toast('A conexão com o servidor não está disponível.');
      return;
    }
    try {
      const result=await expand();
      if(result?.ok!==true) {
        toast(result?.error==='INVENTORY_FULL'
          ? 'O inventário já tem os 10 espaços disponíveis.'
          : result?.error||'O servidor não liberou o próximo espaço.');
        return;
      }
      renderInventory();
      const slotNumber=Number.isInteger(Number(result.slot))?Number(result.slot)+1:nextSlot+1;
      const slotCount=Number(result.slot_count)||inventory.length;
      toast(`Espaço ${slotNumber} liberado · ${slotCount}/${MAX_INVENTORY_SLOTS}`);
    } catch(error) {
      const full=String(error?.message||'').includes('INVENTORY_FULL');
      toast(full?'O inventário já tem os 10 espaços disponíveis.':error?.message||'Não foi possível liberar o próximo espaço.');
    }
  }

  function findEmptyInventorySlot() {
    const slot=Array.from(document.querySelectorAll('.inventory-slot:not(.is-locked)'))
      .map(element=>Number(element.dataset.slot))
      .find(index=>Number.isInteger(index)&&!inventory[index]);
    return slot===undefined?-1:slot;
  }

  async function equipCollectedWearable(item) {
    const targetSlot=item?.wearSlot;
    if(!item||!wearableSlotOrder.includes(targetSlot)) return false;
    if(item.isKingCrown) {
      const claim=await window.KTKOnline?.claimKingCrown?.();
      if(!claim?.ok) {
        toast(claim?.error||'O servidor não confirmou a posse da Coroa Real.');
        return true;
      }
      // A Coroa ocupa a cabeça; qualquer peça anterior é enviada ao mapa pelo servidor.
      if(claim.data?.state) applyServerState(claim.data.state);
      toast(equippedWearables.head?.isKingCrown
        ? 'Você pegou a Coroa Real. Você agora é o rei!'
        : 'A Coroa Real não foi confirmada como equipada.');
      return true;
    }
    return false;
  }

  async function unequipWearable(slot) {
    if(!equippedWearables[slot]) return false;
    const gameAction=window.KTKOnline?.gameAction;
    if(typeof gameAction!=='function') {
      toast('A conexão com o servidor não está disponível.');
      return false;
    }
    try {
      await gameAction('unequip',{wear_slot:slot});
      return true;
    } catch(error) {
      toast(error?.message||'O servidor recusou a retirada.');
      return false;
    }
  }

  function drawInventoryIcon(context,item) {
    if(item?.iconEmoji) {
      context.save();
      context.font='30px system-ui';
      context.textAlign='center';
      context.textBaseline='middle';
      context.fillText(item.iconEmoji,32,32);
      context.restore();
    } else if(item?.iconCanvas) {
      context.imageSmoothingEnabled=false;
      context.drawImage(item.iconCanvas,0,0,64,64);
    } else if(item?.image?.complete&&item.image.naturalWidth) {
      context.imageSmoothingEnabled=false;
      context.drawImage(item.image,item.sourceX||0,item.sourceY||0,item.frameWidth||64,item.frameHeight||64,0,0,64,64);
    }
  }

  function removeCollectedWorldItem(item) {
    if(!item) return;
    const entityId=String(item.entityId||'');
    item.collected=true;

    // Remove todas as referências locais à mesma entidade, não só a primeira.
    worldItems.forEach(candidate=>{
      if(candidate===item||(entityId&&String(candidate.entityId||'')===entityId)) {
        candidate.collected=true;
        worldItems.delete(candidate);
      }
    });

    if(entityId) {
      const known=serverEntityRevisions.get(entityId);
      const revision=Math.max(Number(item.revision)||0,Number(known?.revision)||0);
      // A tombstone impede que uma fotografia antiga recrie o item já coletado.
      serverEntityRevisions.set(entityId,{revision,deleted:true});
      serverWorldEntities.delete(entityId);
    }
    updateKingStatus();
  }

  function renderWearableSlots() {
    document.querySelectorAll('.wearable-slot').forEach(button=>{
      const slot=button.dataset.wearSlot;
      const item=equippedWearables[slot];
      const canvas=button.querySelector('canvas');
      const context=canvas.getContext('2d');
      context.clearRect(0,0,canvas.width,canvas.height);
      if(item) drawInventoryIcon(context,item);
      const name=button.querySelector('span');
      if(name) name.textContent=wearableSlotLabel(slot);
      const maximum=Math.max(0,Number(item?.maxDurability)||0);
      const remaining=Math.max(0,Number(item?.durability)||0);
      const percent=maximum?Math.max(0,Math.min(100,remaining/maximum*100)):0;
      const meter=button.querySelector('.slot-durability-meter');
      const fill=button.querySelector('.slot-durability-meter i');
      button.classList.toggle('has-durability',Boolean(item&&maximum>0));
      button.classList.toggle('durability-worn',Boolean(item&&maximum>0&&percent<=50&&percent>25));
      button.classList.toggle('durability-low',Boolean(item&&maximum>0&&percent<=25));
      if(meter) meter.style.setProperty('--fill',`${percent}%`);
      if(fill) fill.style.width=`${percent}%`;
      button.title=item?`${describeEquipment(item)} | Clique para retirar.`:`Espaco ${wearableSlotLabel(slot)} vazio.`;
      button.setAttribute('aria-label',item?`${wearableSlotLabel(slot)}: ${describeEquipment(item)}`:`${wearableSlotLabel(slot)} vazio`);
    });
  }

  async function collectNearbyItem() {
    // This is only target selection for the interaction button. The server
    // rechecks distance, capacity, stack rules and the actual pickup operation.
    const worldX=camera.x*canvas.clientWidth+player.x;
    const worldY=camera.y*canvas.clientHeight+player.y;
    const hasArrowStack=Boolean(getArrowAmmoStack());
    let itemToCollect=null;
    let closestDistance=Infinity;
    let nearbyArrow=null;
    let nearbyArrowDistance=Infinity;
    worldItems.forEach(item=>{
      if(item.collected) return;
      const distance=Math.hypot(worldX-item.x,worldY-item.y);
      if(distance<closestDistance) {
        closestDistance=distance;
        itemToCollect=item;
      }
      if(hasArrowStack&&isArrowAmmo(item)&&distance<=64&&distance<nearbyArrowDistance) {
        nearbyArrowDistance=distance;
        nearbyArrow=item;
      }
    });
    if(nearbyArrow) {
      itemToCollect=nearbyArrow;
      closestDistance=nearbyArrowDistance;
    }
    if(!itemToCollect) return false;
    if(closestDistance>64) {
      if(!inventory[selectedInventorySlot]) toast(`Chegue mais perto de ${itemToCollect.displayName||'item'} para coletar.`);
      return false;
    }

    if(itemToCollect.isKingCrown) {
      if(itemToCollect.wearSlot) {
        await equipCollectedWearable(itemToCollect);
      } else {
        const claim=await window.KTKOnline?.claimKingCrown?.();
        if(!claim?.ok) toast(claim?.error||'O servidor não confirmou a posse da Coroa Real.');
        else if(claim.data?.state) applyServerState(claim.data.state);
      }
      return true;
    }

    const gameAction=window.KTKOnline?.gameAction;
    if(typeof gameAction!=='function') {
      toast('A conexão com o servidor não está disponível.');
      return true;
    }
    try {
      const result=await gameAction('pickup',{entity_id:itemToCollect.entityId});
      if(result?.ok===true) {
        // Só apaga do mapa depois da confirmação da coleta no servidor.
        removeCollectedWorldItem(itemToCollect);
      } else {
        toast(result?.error||'O servidor não confirmou a coleta.');
      }
      return true;
    } catch(error) {
      // Falha de rede ou RPC não consome o item visualmente.
      toast(error?.message||'O servidor recusou a coleta.');
      return true;
    }
  }

  function drawResourceEntity(g,resource,x,y) {
    if(resource.status==='depleted') return;
    g.save();
    g.imageSmoothingEnabled=false;
    if(resource.resourceKind==='tree') {
      g.fillStyle='#684a2c'; g.fillRect(x-4,y+2,8,23);
      g.fillStyle='#315f37'; g.beginPath(); g.arc(x,y-5,18,0,Math.PI*2); g.fill();
      g.fillStyle='#477b43'; g.beginPath(); g.arc(x-9,y-12,11,0,Math.PI*2); g.fill();
    } else if(resource.resourceKind==='ore') {
      g.fillStyle='#74766f'; g.beginPath(); g.moveTo(x-18,y+10); g.lineTo(x-12,y-9); g.lineTo(x+2,y-17); g.lineTo(x+18,y-5); g.lineTo(x+15,y+12); g.closePath(); g.fill();
      g.fillStyle='#b8b9b2'; g.fillRect(x-3,y-9,7,4); g.fillRect(x+7,y+1,5,3);
    } else if(resource.resourceKind==='bush') {
      g.fillStyle='#386d36'; g.beginPath(); g.arc(x-7,y+1,10,0,Math.PI*2); g.arc(x+6,y-4,12,0,Math.PI*2); g.arc(x+13,y+5,8,0,Math.PI*2); g.fill();
      g.fillStyle='#c64a45'; g.fillRect(x-8,y-5,4,4); g.fillRect(x+5,y+2,4,4); g.fillRect(x+12,y-8,4,4);
    } else {
      g.fillStyle='rgba(83,160,191,.34)'; g.beginPath(); g.ellipse(x,y+6,20,9,0,0,Math.PI*2); g.fill();
      g.fillStyle='#65b9cb'; g.beginPath(); g.arc(x,y,11,0,Math.PI*2); g.fill();
      g.fillStyle='#d8f4f5'; g.fillRect(x-3,y-7,4,6);
    }
    if(resource.health>0&&resource.maxHealth>1) {
      const width=34, percent=Math.max(0,Math.min(1,resource.health/resource.maxHealth));
      g.fillStyle='rgba(0,0,0,.65)'; g.fillRect(x-width/2,y-30,width,4);
      g.fillStyle='#91d17b'; g.fillRect(x-width/2,y-30,width*percent,4);
    }
    g.fillStyle='rgba(20,30,20,.86)'; g.font='10px system-ui'; g.textAlign='center';
    g.fillText(resource.displayName||'Recurso',x,y+31);
    g.restore();
  }

  function drawWorldItem(g,item,x,y) {
    if(typeof item.draw==='function') {
      item.draw(g,x,y);
      return;
    }
    if(item.isKingCrown) {
      g.save();
      g.fillStyle='rgba(220,176,53,.22)';
      g.beginPath();
      g.ellipse(x,y+6,20,9,0,0,Math.PI*2);
      g.fill();
      g.strokeStyle='rgba(244,211,106,.9)';
      g.lineWidth=2;
      g.beginPath();
      g.ellipse(x,y+6,20,9,0,0,Math.PI*2);
      g.stroke();
      g.restore();
    }
    if(item.iconEmoji) {
      g.save();
      g.fillStyle='rgba(25,35,25,.8)';
      g.beginPath(); g.arc(x,y,17,0,Math.PI*2); g.fill();
      g.font='22px system-ui'; g.textAlign='center'; g.textBaseline='middle';
      g.fillText(item.iconEmoji,x,y);
      g.restore();
      return;
    }
    if(item.iconCanvas) {
      const size=item.iconSize||item.displaySize||38;
      g.save();
      g.imageSmoothingEnabled=false;
      g.drawImage(item.iconCanvas,x-size/2,y-size/2,size,size);
      g.restore();
      return;
    }
    if(!item.image?.complete||!item.image.naturalWidth) return;
    const width=item.displaySize||item.frameWidth||64;
    const height=item.displayHeight||item.frameHeight||64;
    g.save();
    g.imageSmoothingEnabled=false;
    g.drawImage(
      item.image,
      item.sourceX||0,item.sourceY||0,item.frameWidth||width,item.frameHeight||height,
      x-width/2,y-height/2,width,height
    );
    g.restore();
  }

  async function harvestNearbyResource() {
    const worldX=camera.x*canvas.clientWidth+player.x;
    const worldY=camera.y*canvas.clientHeight+player.y;
    const nearby=[...serverWorldEntities.values()]
      .filter(entity=>entity.type==='resource'&&entity.status!=='depleted')
      .map(entity=>({entity,distance:Math.hypot(worldX-entity.x,worldY-entity.y)}))
      .filter(entry=>entry.distance<=80)
      .sort((a,b)=>a.distance-b.distance)[0];
    if(!nearby) return false;
    try {
      const result=await window.KTKOnline?.gameAction?.('harvest',{entity_id:nearby.entity.entityId});
      if(result?.depleted) toast(`${nearby.entity.displayName} coletado.`);
      else toast(`Você trabalhou em ${nearby.entity.displayName}.`);
    } catch(error) {
      toast(error?.message||'O servidor recusou a coleta do recurso.');
    }
    return true;
  }

  function findNearbyWorldItemForSwap() {
    const worldX=camera.x*canvas.clientWidth+player.x;
    const worldY=camera.y*canvas.clientHeight+player.y;
    const hasArrowStack=Boolean(getArrowAmmoStack());
    let closestItem=null;
    let closestDistance=Infinity;
    let nearbyArrow=null;
    let nearbyArrowDistance=Infinity;

    worldItems.forEach(item=>{
      if(item.collected) return;
      const distance=Math.hypot(worldX-item.x,worldY-item.y);
      if(distance<closestDistance) {
        closestDistance=distance;
        closestItem=item;
      }
      if(hasArrowStack&&isArrowAmmo(item)&&distance<=64&&distance<nearbyArrowDistance) {
        nearbyArrow=item;
        nearbyArrowDistance=distance;
      }
    });

    if(nearbyArrow) return nearbyArrow;
    return closestDistance<=64?closestItem:null;
  }

  async function interactWithSelectedItem() {
    if(await harvestNearbyResource()) return;

    let selectedItem=inventory[selectedInventorySlot];
    const nearbyItem=findNearbyWorldItemForSwap();
    const alreadyHasStack=Boolean(nearbyItem?.isStackable
      &&inventory.some(item=>item?.id===nearbyItem.id));

    // E troca o item do espaço selecionado pelo objeto próximo.
    // Pilhas, munições já possuídas e vestimentas continuam no fluxo de coleta.
    if(selectedItem&&nearbyItem&&!nearbyItem.isKingCrown&&!nearbyItem.wearSlot&&!alreadyHasStack) {
      const swapInventoryItem=window.KTKOnline?.swapInventoryItem;
      if(typeof swapInventoryItem==='function') {
        try {
          const result=await swapInventoryItem(nearbyItem.entityId,selectedInventorySlot,player.direction);
          if(result?.ok!==true) {
            toast(result?.error||'O servidor não confirmou a troca.');
            return;
          }
          removeCollectedWorldItem(nearbyItem);
          renderInventory();
          toast(`Trocou ${selectedItem.displayName||'o item'} por ${nearbyItem.displayName||'o item do chão'}.`);
          return;
        } catch(error) {
          toast(error?.message||'O servidor recusou a troca dos itens.');
          return;
        }
      }
    }

    if(await collectNearbyItem()) return;

    selectedItem=inventory[selectedInventorySlot];
    if(!selectedItem) return;
    if(['food','drink'].includes(selectedItem.itemType)) {
      try {
        const result=await window.KTKOnline?.gameAction?.('consume',{slot:selectedInventorySlot});
        if(result?.ok===false) {
          toast(result.error||'O servidor não permitiu consumir este item.');
          return;
        }
        toast(selectedItem.itemType==='food'?'Você comeu o alimento.':'Você bebeu a água.');
      } catch(error) {
        toast(error?.message||'O servidor não permitiu consumir este item.');
      }
      return;
    }

    if(selectedItem.type!=='item'||!selectedItem.id) {
      toast('Este item nao pode ser solto.');
      return;
    }

    try {
      const result=await window.KTKOnline?.gameAction?.('drop',{
        slot:selectedInventorySlot,direction:player.direction
      });
      if(result?.ok!==true) {
        toast(result?.error||'O servidor não confirmou o descarte.');
        return;
      }
      renderInventory();
      toast(`${selectedItem.displayName||'Item'} solto.`);
    } catch(error) {
      toast(error?.message||'O servidor recusou o descarte.');
    }
  }
  // Entrada para sincronização futura de posições vindas do servidor online.