import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [inventoryUi, input, actions, online, html, migration] = await Promise.all([
  read("../inventory/inventory-ui.js"),
  read("../input/input-controller.js"),
  read("../online/actions.js"),
  read("../js/online.js"),
  read("../campo_livre_atualizado.html"),
  read("../supabase/migrations/20261118130352_swap_selected_inventory_item.sql")
]);

assert.match(input, /if\(key==='e'&&!event\.repeat\) interactWithSelectedItem\(\)/,
  "E deve acionar a interação uma única vez por pressionamento.");
assert.doesNotMatch(inventoryUi, /Number\.isFinite\(selectedItem\.x\)|Number\.isFinite\(selectedItem\.y\)/,
  "Itens do inventário não precisam carregar coordenadas para serem soltos.");

const interactionStart=inventoryUi.indexOf("  function findNearbyWorldItemForSwap()");
const interactionEnd=inventoryUi.indexOf("  // Entrada para sincronização futura",interactionStart);
assert.ok(interactionStart>=0&&interactionEnd>interactionStart,
  "A interação de inventário deve manter a busca do item próximo e a ação de E.");
const interactionCode=inventoryUi.slice(interactionStart,interactionEnd)
  +"\nglobalThis.runInventoryInteraction=interactWithSelectedItem;";

function makeInteractionContext({selected,nearby=null}={}) {
  const calls=[];
  const toasts=[];
  let removed=null;
  let renderCount=0;
  const context={
    inventory:[selected||null,null],
    selectedInventorySlot:0,
    camera:{x:0,y:0},
    canvas:{clientWidth:1280,clientHeight:720},
    player:{x:0,y:0,direction:3},
    worldItems:new Set(nearby?[nearby]:[]),
    getArrowAmmoStack:()=>null,
    isArrowAmmo:()=>false,
    harvestNearbyResource:async()=>false,
    collectNearbyItem:async()=>false,
    removeCollectedWorldItem(item){removed=item;},
    renderInventory(){renderCount++;},
    toast(message){toasts.push(String(message));},
    window:{KTKOnline:{
      async gameAction(action,payload){
        calls.push({action,payload});
        return {ok:true};
      },
      async swapInventoryItem(entityId,slot,direction){
        calls.push({action:"swap",entityId,slot,direction});
        return {ok:true};
      }
    }}
  };
  vm.createContext(context);
  vm.runInContext(interactionCode,context);
  return {
    context,calls,toasts,
    get removed(){return removed;},
    get renderCount(){return renderCount;}
  };
}

// Os itens do inventário não têm x/y. E ainda assim precisa chamar a ação drop.
const drop=makeInteractionContext({
  selected:{type:"item",id:"equipment-arming-sword",displayName:"Espada",itemType:"equipment"}
});
await drop.context.runInventoryInteraction();
assert.deepEqual(JSON.parse(JSON.stringify(drop.calls)),[{action:"drop",payload:{slot:0,direction:3}}]);
assert.ok(drop.toasts.some(message=>message.includes("Espada solto")));
assert.equal(drop.renderCount,1);

// Com um item no chão e espaço selecionado ocupado, E faz uma troca atômica.
const groundBow={
  type:"item",id:"equipment-bow-normal",entityId:"loot-bow",displayName:"Arco",
  x:32,y:0,wearSlot:null,isKingCrown:false,isStackable:false,collected:false
};
const swap=makeInteractionContext({
  selected:{type:"item",id:"equipment-arming-sword",displayName:"Espada",itemType:"equipment"},
  nearby:groundBow
});
await swap.context.runInventoryInteraction();
assert.deepEqual(JSON.parse(JSON.stringify(swap.calls)),[{action:"swap",entityId:"loot-bow",slot:0,direction:3}]);
assert.equal(swap.removed,groundBow,
  "A entidade de chão substituída deve ser removida localmente após confirmação do servidor.");
assert.ok(swap.toasts.some(message=>message.includes("Trocou Espada por Arco")));
assert.equal(swap.renderCount,1);

// Quando o item encontrado é uma pilha já existente ou uma vestimenta, não deve trocar;
// esses casos continuam a passar pelo pickup normal.
assert.match(inventoryUi,/alreadyHasStack/);
assert.match(inventoryUi,/!nearbyItem\.wearSlot/);

assert.match(actions,/POSITION_SYNC_ACTIONS = new Set\(\[\.\.\.POSITION_SENSITIVE_ACTIONS, "drop"\]\)/,
  "O descarte deve sincronizar a posição atual antes de criar o objeto.");
assert.match(actions,/supabase\.rpc\("ktk_swap_inventory_item"/);
assert.match(actions,/await syncPositionForAction\(\)/);
assert.match(online,/swapInventoryItem/);
assert.match(html,/inventory-ui\.js\?v=20261118-inventory-interaction-v1/);
assert.match(html,/online\.js\?v=20261118-inventory-interaction-v1/);

assert.match(migration,/FOR UPDATE/);
assert.match(migration,/sqrt\(power\(v_player\.x-v_ground\.x, 2\) \+ power\(v_player\.y-v_ground\.y, 2\)\) > 64/);
assert.match(migration,/v_old_item \|\| jsonb_build_object\('status', 'ground'\)/);
assert.match(migration,/DELETE FROM public\.ktk_world_entities/);
assert.match(migration,/ARRAY\[p_slot::text\]/);
assert.match(migration,/GRANT EXECUTE ON FUNCTION public\.ktk_swap_inventory_item/);

console.log("Inventory E interaction passed: selected items drop without x/y, nearby ground items swap into the selected slot, and world entities remain server-authoritative.");
