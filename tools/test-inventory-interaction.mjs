import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [inventoryUi, input, actions, online, html, swapMigration, capacityMigration, inventoryState, gameState, lifecycle, css] = await Promise.all([
  read("../inventory/inventory-ui.js"),
  read("../input/input-controller.js"),
  read("../online/actions.js"),
  read("../js/online.js"),
  read("../campo_livre_atualizado.html"),
  read("../supabase/migrations/20261118130352_swap_selected_inventory_item.sql"),
  read("../supabase/migrations/20261118142318_expand_inventory_slots_one_by_one.sql"),
  read("../inventory/inventory-state.js"),
  read("../js/game-state.js"),
  read("../game/game-lifecycle.js"),
  read("../css/game.css")
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
assert.match(html,/inventory-ui\.js\?v=20261118-inventory-expansion-v1/);
assert.match(html,/online\.js\?v=20261118-inventory-expansion-v1/);

assert.match(swapMigration,/FOR UPDATE/);
assert.match(swapMigration,/sqrt\(power\(v_player\.x-v_ground\.x, 2\) \+ power\(v_player\.y-v_ground\.y, 2\)\) > 64/);
assert.match(swapMigration,/v_old_item \|\| jsonb_build_object\('status', 'ground'\)/);
assert.match(swapMigration,/DELETE FROM public\.ktk_world_entities/);
assert.match(swapMigration,/ARRAY\[p_slot::text\]/);
assert.match(swapMigration,/GRANT EXECUTE ON FUNCTION public\.ktk_swap_inventory_item/);


assert.ok(input.includes("if(key==='n'&&!event.repeat) { event.preventDefault(); void expandInventorySlot(); }"));

// Atalhos numéricos: 1–9 selecionam os slots correspondentes e 0 seleciona o décimo.
// O teste usa o seletor real para garantir que espaços ainda bloqueados não façam RPC.
const selectStart=inventoryUi.indexOf("  function selectInventorySlot(index) {");
const selectEnd=inventoryUi.indexOf("\\n  async function expandInventorySlot()",selectStart);
assert.ok(selectStart>=0&&selectEnd>selectStart);
const selectCode=inventoryUi.slice(selectStart,selectEnd);
const keydownStart=input.indexOf("  window.addEventListener('keydown',event=>{");
const keydownEnd=input.indexOf("\\n  window.addEventListener('keyup'",keydownStart);
assert.ok(keydownStart>=0&&keydownEnd>keydownStart);
const keydownCode=input.slice(keydownStart,keydownEnd);
const numericSelectionCalls=[];
const keyboardContext={
  inventory:[null,null],
  selectedInventorySlot:0,
  keys:new Set(),
  gameStarted:true,
  screens:{game:{classList:{contains:()=>true}}},
  refreshLocalMovementInput(){},
  window:{
    KTKOnline:{gameAction(action,payload){
      numericSelectionCalls.push({action,payload});
      return Promise.resolve({ok:true});
    }},
    addEventListener(type,handler){
      if(type==="keydown") this.keydownHandler=handler;
    }
  }
};
vm.createContext(keyboardContext);
vm.runInContext(selectCode+"\\n"+keydownCode,keyboardContext);
const pressDigit=(key,repeat=false)=>{
  keyboardContext.keys.clear();
  keyboardContext.window.keydownHandler({key,repeat,preventDefault(){}});
};
pressDigit("1");
pressDigit("2");
pressDigit("3");
pressDigit("0");
assert.deepEqual(JSON.parse(JSON.stringify(numericSelectionCalls)),[
  {action:"select_slot",payload:{slot:0}},
  {action:"select_slot",payload:{slot:1}}
],"Somente os dois espaços liberados inicialmente podem ser selecionados.");

keyboardContext.inventory.push(...Array.from({length:8},()=>null));
for(const key of ["3","4","5","6","7","8","9","0"]) pressDigit(key);
assert.deepEqual(
  JSON.parse(JSON.stringify(numericSelectionCalls.slice(2))),
  Array.from({length:8},(_,i)=>({action:"select_slot",payload:{slot:i+2}})),
  "As teclas 3–9 e 0 devem selecionar os slots 3–10, com 0 no décimo."
);
pressDigit("0",true);
assert.equal(numericSelectionCalls.length,10,
  "Repetição de tecla pressionada não deve alternar ou disparar outra seleção.");
assert.ok(inventoryUi.includes("async function expandInventorySlot()"));
assert.ok(inventoryUi.includes("inventory.length>=MAX_INVENTORY_SLOTS"));
assert.ok(inventoryUi.includes("window.KTKOnline?.expandInventorySlot"));
assert.ok(actions.includes('supabase.rpc("ktk_expand_inventory_slot")'));
assert.ok(online.includes("expandInventorySlot"));
assert.ok(inventoryState.includes("serverState.inventory.slice(0,MAX_INVENTORY_SLOTS)"));
assert.ok(gameState.includes("var  MAX_INVENTORY_SLOTS = 10;"));
assert.ok(lifecycle.includes("inventory.splice(0,inventory.length,null,null)"));
assert.ok(css.includes(".inventory-slots { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); grid-template-rows:repeat(2,48px); gap:6px; width:100%; }"));
assert.ok(css.includes(".inventory-slot.is-locked { display:grid;"));
assert.ok(input.includes("inventorySlots?.addEventListener('click'"));
assert.equal(html.split('data-slot="').length-1,10);
assert.equal(html.split('class="inventory-quantity"').length-1,10);
assert.ok(capacityMigration.includes("PERFORM 1 FROM public.ktk_worlds WHERE id='main' FOR UPDATE"));
assert.ok(capacityMigration.includes("AND is_alive=true"));
assert.ok(capacityMigration.includes("FOR UPDATE;"));
assert.ok(capacityMigration.includes("v_inventory:=v_inventory || jsonb_build_array(NULL)"));
assert.ok(capacityMigration.includes("v_slot_count>=10"));
assert.ok(capacityMigration.includes("GRANT EXECUTE ON FUNCTION public.ktk_expand_inventory_slot() TO authenticated"));

console.log("Inventory capacity: the 10-slot grid stays fixed and N unlocks one server-authorized slot per press; E drop/swap remains intact.");
