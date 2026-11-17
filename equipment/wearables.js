/* Definições visuais de armaduras, vestimentas e posições das camadas. */
(function(){
  'use strict';
  const data=window.KTKEquipmentModules.data, factory=window.KTKEquipmentModules.itemFactory;
  const WEARABLE_SLOTS=[
  {
    "slot": "head",
    "name": "Armor - Head",
    "sprite": "hat/helmet/armet/adult/walk.png",
    "appearanceLayers": [
      {
        "z": 130,
        "path": "hat/helmet/armet/adult/walk.png"
      }
    ]
  },
  {
    "slot": "chest",
    "name": "Armor - Chest",
    "sprite": "torso/armour/plate/male/walk.png",
    "appearanceLayers": [
      {
        "z": 65,
        "path": "torso/armour/plate/{gender}/walk.png"
      }
    ]
  },
  {
    "slot": "waist",
    "name": "Armor - Back",
    "sprite": "torso/waist/belt_leather/male/walk.png",
    "appearanceLayers": [
      {
        "z": 30,
        "path": "torso/waist/belt_leather/{gender}/walk.png"
      }
    ]
  },
  {
    "slot": "legs",
    "name": "Armor - Legs",
    "sprite": "legs/armour/plate/male/walk.png",
    "appearanceLayers": [
      {
        "z": 28,
        "path": "legs/armour/plate/{lowerBodyGender}/walk.png"
      }
    ]
  },
  {
    "slot": "feet",
    "name": "Armor - Feet",
    "sprite": "feet/armour/plate/male/walk.png",
    "appearanceLayers": [
      {
        "z": 32,
        "path": "feet/armour/plate/{lowerBodyGender}/walk.png"
      }
    ]
  }
];
  function makeWearableItem(config){
    return factory.createItem({itemType:'equipment',equipmentClass:'apparel',category:'Vestimentas',...config});
  }
  function buildWearableSections(){
    return WEARABLE_SLOTS.map(slotInfo=>{
      const baseDisplayName=({head:'Helmet',chest:'Plate Armor',waist:'Armored Belt',legs:'Greaves',feet:'Armored Boots'})[slotInfo.slot];
      const baseItem=makeWearableItem({
        id:'armor-'+slotInfo.slot+'-base',displayName:baseDisplayName,sprite:slotInfo.sprite,
        wearSlot:slotInfo.slot,wearCategory:'armor',appearanceLayers:slotInfo.appearanceLayers
      });
      const items=data.MATERIAL_ORDER.map(material=>{
        const color=data.MATERIAL_COLORS[material];
        const appearanceLayers=slotInfo.appearanceLayers.map(layer=>({...layer,mode:'tint',palette:color.hex}));
        const details=data.ARMOR_DETAILS[material]||{};
        if(slotInfo.slot==='chest'){
          if(details.sleeves)appearanceLayers.push({z:64,path:'torso/clothes/longsleeve/longsleeves/{gender}/walk.png',mode:'tint',palette:color.hex});
          if(details.gloves)appearanceLayers.push({z:66,path:'arms/hands/gloves/{armGender}/walk.png',mode:'tint',palette:color.hex});
        }
        const item={...baseItem,id:'armor-'+slotInfo.slot+'-'+material,displayName:color.name+' '+baseDisplayName,
          material,materialName:color.name,appearanceLayers,collected:false,authoritative:false,
          durability:0,maxDurability:0,armorDefense:0,speedPenalty:0};
        baseItem.image.addEventListener('load',()=>{item.iconCanvas=baseItem.iconCanvas;},{once:true});
        return item;
      });
      return {name:slotInfo.name,items};
    }).concat([{
      name:'Cosmetic Apparel',
      items:[
        makeWearableItem({id:'king-crown',displayName:'Coroa Real',sprite:'hat/formal/crown/adult/walk.png',wearSlot:'head',wearCategory:'cosmetic',isKingCrown:true,appearanceLayers:[{z:130,path:'hat/formal/crown/adult/walk.png'}],iconSize:36}),
        makeWearableItem({id:'cosmetic-sack-cloth-hood',displayName:'Sack Cloth Hood',sprite:'hat/cloth/hood_sack/adult/walk.png',wearSlot:'head',wearCategory:'cosmetic',appearanceLayers:[{z:130,path:'hat/cloth/hood_sack/adult/walk.png'}]}),
        makeWearableItem({id:'cosmetic-cape',displayName:'Simple Cape',sprite:'cape/solid/fg/walk.png',wearSlot:'waist',wearCategory:'cosmetic',appearanceLayers:[{z:8,path:'cape/solid/bg/walk.png'},{z:126,path:'cape/solid/fg/walk.png'}]}),
        makeWearableItem({id:'cosmetic-linen-shirt',displayName:'Linen Shirt',sprite:'torso/clothes/shortsleeve/shortsleeve/male/walk.png',wearSlot:'chest',wearCategory:'cosmetic',appearanceLayers:[{z:65,path:'torso/clothes/shortsleeve/shortsleeve/{gender}/walk.png'}]}),
        makeWearableItem({id:'cosmetic-trousers',displayName:'Dark Trousers',sprite:'legs/pants2/male/walk.png',wearSlot:'legs',wearCategory:'cosmetic',recolorMode:'black',appearanceLayers:[{z:22,path:'legs/pants2/{lowerBodyGender}/walk.png',mode:'black'}]}),
        makeWearableItem({id:'cosmetic-shoes',displayName:'Simple Shoes',sprite:'feet/shoes/basic/male/walk.png',wearSlot:'feet',wearCategory:'cosmetic',recolorMode:'black',appearanceLayers:[{z:27,path:'feet/shoes/basic/{shoeGender}/walk.png',mode:'black'}]}),
        makeWearableItem({id:'cosmetic-leather-belt',displayName:'Leather Belt',sprite:'torso/waist/belt_leather/male/walk.png',wearSlot:'waist',wearCategory:'cosmetic',appearanceLayers:[{z:30,path:'torso/waist/belt_leather/{gender}/walk.png'}]})
      ]
    }]);
  }
  window.KTKEquipmentModules.wearables={WEARABLE_SLOTS,buildWearableSections};
})();
