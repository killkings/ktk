import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [migration, input, inventoryUi, inventoryState] = await Promise.all([
  read("../supabase/migrations/20261118022700_separate_wearables_from_inventory.sql"),
  read("../input/input-controller.js"),
  read("../inventory/inventory-ui.js"),
  read("../inventory/inventory-state.js")
]);

const pickupStart = migration.indexOf("elsif p_action='pickup' then");
const harvestStart = migration.indexOf("elsif p_action='harvest' then", pickupStart);
assert.ok(pickupStart >= 0 && harvestStart > pickupStart);
const pickup = migration.slice(pickupStart, harvestStart);
assert.ok(pickup.indexOf("if v_item_def.wear_slot is not null")
  < pickup.indexOf("elsif coalesce((v_item_def.metadata->>'stackable')::boolean,false)"),
  "Vestimentas devem ser tratadas antes de qualquer caminho do inventário.");
assert.match(pickup, /v_old_wearable\|\|jsonb_build_object\('status','ground'\)/,
  "A peça substituída precisa virar um item no mapa.");
assert.match(pickup, /v_wearables:=jsonb_set\(v_wearables,array\[v_wear_slot\],v_item,true\)/,
  "A peça coletada precisa equipar no espaço correspondente.");

const unequipStart = migration.indexOf("elsif p_action='unequip' then");
assert.ok(unequipStart >= 0);
const unequip = migration.slice(unequipStart, harvestStart);
assert.match(unequip, /insert into public\.ktk_world_entities/i,
  "Retirar uma peça deve criar uma entidade no mapa.");
assert.doesNotMatch(unequip, /INVENTORY_FULL|v_inventory:=jsonb_set\(v_inventory/,
  "Retirar uma peça não pode ocupar vaga do inventário.");

assert.doesNotMatch(input, /dragstart|dragover|dragleave|equipWearableFromInventory|suppressWearSlotClick|draggedWearableIndex/,
  "A interface não deve permitir arrastar roupa para os espaços de equipamento.");
assert.match(input, /wearable-slot[\s\S]*?addEventListener\('click',\(\)=>unequipWearable/,
  "Clicar na roupa vestida deve chamar a retirada para o mapa.");
assert.match(inventoryUi, /slot\.draggable=false;/,
  "Itens de inventário não podem ser arrastáveis como vestimentas.");
assert.doesNotMatch(inventoryUi, /equipWearableFromInventory|guardada no inventário/,
  "A interface não deve exibir o fluxo antigo de guardar roupas na mochila.");
assert.match(inventoryState, /if\(item\?\.wearSlot\) return null;/,
  "Snapshots antigos também não devem inserir vestimentas na mochila.");
assert.match(migration, /DO \$wearable_cleanup\$[\s\S]*?SET state=jsonb_set/,
  "Dados antigos precisam ser normalizados para os espaços de vestimenta.");

console.log("Wearables are separated: pickup equips, replacement drops the old item, clicking worn gear drops it, and inventory rejects apparel.");
