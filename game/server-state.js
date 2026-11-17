/* Coordena o estado recebido do servidor sem misturar catálogo e renderização do inventário. */
'use strict';
function applyServerState(serverState) {
  if(!serverState || typeof serverState!=='object') return false;
  const stats=window.KTKPlayerStats?.stats;
  let selectedSlotChanged=false;
  if(stats) {
    selectedSlotChanged=applySelectedInventorySlotFromServer(serverState);
    ['health','satiety','hydration','stamina','mana','magicLevel','temperature','attack','defense'].forEach(key=>{
      const source=key==='magicLevel'?'magic_level':key;
      if(serverState[source]!==undefined && stats[key]) {
        stats[key].value=Math.max(stats[key].min,Math.min(stats[key].max,Number(serverState[source])||0));
      }
    });
    window.KTKPlayerStats.render();
  }
  const changes=applyInventoryContentsFromServer(serverState);
  if(changes.inventoryChanged||changes.wearablesChanged||selectedSlotChanged) renderInventory();
  if(changes.wearablesChanged) void rebuildCharacterLayers().catch(error=>console.warn('KTK appearance update:',error));
  return true;
}
