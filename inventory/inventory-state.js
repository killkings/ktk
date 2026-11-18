/* Aplica ao modelo local somente os dados de inventário e vestimentas confirmados pelo servidor. */
'use strict';
function applySelectedInventorySlotFromServer(serverState) {
  if (!Number.isInteger(Number(serverState?.selected_slot))) return false;
  const nextSlot=Math.max(0,Math.min(inventory.length-1,Number(serverState.selected_slot)));
  const changed=nextSlot!==selectedInventorySlot;
  selectedInventorySlot=nextSlot;
  return changed;
}
function applyInventoryContentsFromServer(serverState) {
  let inventoryChanged=false;
  let wearablesChanged=false;
  if(Array.isArray(serverState?.inventory)) {
    const signature=JSON.stringify(serverState.inventory);
    if(signature!==lastServerInventorySignature) {
      inventory.splice(0,inventory.length,...serverState.inventory.slice(0,2).map(entry=>{
        if(!entry || entry==='null') return null;
        const id=entry.item_id;
        let item=id==='longsword-1'?window.KTKWorldSword?.entity:equipmentCatalog?.items.find(candidate=>candidate.id===id);
        if(!item) item=makeServerDropItem(id,entry);
        // Defesa visual adicional: mesmo um snapshot legado não coloca roupa na mochila.
        if(item?.wearSlot) return null;
        return item?{...item,...entry,id,collected:true}:null;
      }));
      lastServerInventorySignature=signature;
      inventoryChanged=true;
    }
  }
  if(serverState?.wearables) {
    const signature=JSON.stringify(serverState.wearables);
    if(signature!==lastServerWearablesSignature) {
      wearableSlotOrder.forEach(slot=>{
        const entry=serverState.wearables[slot];
        if(!entry || entry==='null') { equippedWearables[slot]=null; return; }
        const id=entry.item_id;
        const item=equipmentCatalog?.items.find(candidate=>candidate.id===id);
        equippedWearables[slot]=item?{...item,...entry,id,collected:true}:null;
      });
      lastServerWearablesSignature=signature;
      wearablesChanged=true;
    }
  }
  return {inventoryChanged,wearablesChanged};
}
