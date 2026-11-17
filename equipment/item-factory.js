/* Fábrica de objetos visuais e hidratação dos atributos vindos do catálogo do servidor. */
(function () {
  'use strict';
  const modules=window.KTKEquipmentModules, data=modules.data, renderer=modules.itemRenderer;
  const FRAME_SIZE=data.FRAME_SIZE, SPRITE_ROOT=data.SPRITE_ROOT;

  function createItem(config) {
    const item = {
      id:config.id,type:'item',itemType:'equipment',equipmentClass:config.equipmentClass||null,
      wearSlot:null,wearCategory:config.wearCategory||null,
      isKingCrown:Boolean(config.isKingCrown||config.id==='king-crown'),
      armorDefense:0,speedPenalty:0,
      appearanceLayers:Array.isArray(config.appearanceLayers)?config.appearanceLayers:[],
      material:config.material||null,materialName:config.materialName||'',
      workEfficiency:0,materialDamageBonuses:{},twoHanded:false,
      category:config.category,displayName:config.displayName,
      attackBonus:0,range:0,staminaCost:0,attackInterval:0,defenseBonus:0,
      manaCost:0,ammoKey:null,isStackable:false,quantity:config.quantity,
      durability:0,maxDurability:0,durabilityUnit:'',
      iconFrameSize:config.iconFrameSize||FRAME_SIZE,iconSize:Number(config.iconSize)||36,
      iconFillSize:Number(config.iconFillSize)||50,heldFrameSize:Number(config.heldFrameSize)||FRAME_SIZE,
      heldDisplaySize:Number(config.heldDisplaySize)||FRAME_SIZE,attackDisplaySize:Number(config.attackDisplaySize)||0,
      attackBackgroundZ:Number.isFinite(Number(config.attackBackgroundZ))?Number(config.attackBackgroundZ):null,
      attackReverseBodyFrames:Boolean(config.attackReverseBodyFrames),attackFrameSize:Number(config.attackFrameSize)||0,
      equipmentZ:Number.isFinite(Number(config.equipmentZ))?Number(config.equipmentZ):150,
      attackEquipmentZ:Number.isFinite(Number(config.attackEquipmentZ))?Number(config.attackEquipmentZ):null,
      heldStaticFrame:Number.isInteger(config.heldStaticFrame)?config.heldStaticFrame:null,
      heldBackgroundStaticFrame:Number.isInteger(config.heldBackgroundStaticFrame)?config.heldBackgroundStaticFrame:null,
      attackFrameCount:Number(config.attackFrameCount)||6,attackType:config.attackType||'slash',
      radius:12,collected:false,sourceX:0,sourceY:0,frameWidth:FRAME_SIZE,frameHeight:FRAME_SIZE
    };
    const image=new Image();
    image.crossOrigin='anonymous'; item.image=image;
    image.onload=()=>{
      const iconSource=renderer.recolorItemSprite(image,config.recolorMode);
      if(!config.iconSprite) item.iconCanvas=renderer.createConfiguredIcon(iconSource,config,item);
      item.heldFrameSize=renderer.inferredFrameSize(image,config.heldFrameSize);
      if(config.attackUsesHeldSprite){item.attackImage=image;item.attackFrameSize=renderer.inferredFrameSize(image,config.attackFrameSize);}
    };
    image.onerror=()=>console.warn('Sprite de equipamento não encontrado:',config.sprite);
    image.src=SPRITE_ROOT+config.sprite;
    if(config.iconSprite){
      const iconImage=new Image();iconImage.crossOrigin='anonymous';item.iconImage=iconImage;
      iconImage.onload=()=>{item.iconCanvas=renderer.createConfiguredIcon(iconImage,config,item);};
      iconImage.onerror=()=>console.warn('Sprite de ícone não encontrado:',config.iconSprite);
      iconImage.src=SPRITE_ROOT+config.iconSprite;
    }
    if(config.attackSprite){
      const attackImage=new Image();attackImage.crossOrigin='anonymous';item.attackImage=attackImage;
      attackImage.onload=()=>{item.attackFrameSize=renderer.inferredFrameSize(attackImage,config.attackFrameSize);};
      attackImage.onerror=()=>console.warn('Sprite de ataque não encontrado:',config.attackSprite);
      attackImage.src=SPRITE_ROOT+config.attackSprite;
    }
    if(config.attackBackgroundSprite){
      const imageBackground=new Image();imageBackground.crossOrigin='anonymous';item.attackBackgroundImage=imageBackground;
      imageBackground.onload=()=>{item.attackFrameSize=renderer.inferredFrameSize(imageBackground,config.attackFrameSize);};
      imageBackground.onerror=()=>console.warn('Sprite de ataque não encontrado:',config.attackBackgroundSprite);
      imageBackground.src=SPRITE_ROOT+config.attackBackgroundSprite;
    }
    if(config.heldBackgroundSprite){
      const heldBackgroundImage=new Image();heldBackgroundImage.crossOrigin='anonymous';item.heldBackgroundImage=heldBackgroundImage;
      heldBackgroundImage.onload=()=>{item.heldFrameSize=renderer.inferredFrameSize(heldBackgroundImage,config.heldFrameSize);};
      heldBackgroundImage.onerror=()=>console.warn('Sprite de equipamento não encontrado:',config.heldBackgroundSprite);
      heldBackgroundImage.src=SPRITE_ROOT+config.heldBackgroundSprite;
    }
    return item;
  }

  function asNumber(value){const n=Number(value);return Number.isFinite(n)?n:0;}
  function equipmentClassForDatabaseType(type){
    return ({weapon:'melee',tool:'tool',shield:'shield',ranged:'ranged',magic:'magic',armor:'apparel',apparel:'apparel',ammo:'ammunition'})[type]||'equipment';
  }
  function applyAuthoritativeItem(item,row){
    const metadata=row.metadata&&typeof row.metadata==='object'&&!Array.isArray(row.metadata)?row.metadata:{};
    const databaseType=String(row.item_type||'');
    item.serverItemType=databaseType;
    item.itemType=databaseType==='ammo'?'ammo':'equipment';
    item.equipmentClass=equipmentClassForDatabaseType(databaseType);
    item.wearCategory=databaseType==='armor'?'armor':databaseType==='apparel'?'cosmetic':null;
    item.wearSlot=row.wear_slot||null;
    item.displayName=String(row.display_name||item.displayName||item.id);
    item.attackBonus=asNumber(row.attack_bonus);
    item.defenseBonus=asNumber(row.defense_bonus);
    item.armorDefense=databaseType==='armor'?asNumber(row.defense_bonus):0;
    item.range=asNumber(row.range_tiles);
    item.staminaCost=asNumber(row.stamina_cost);
    item.attackInterval=asNumber(row.attack_interval);
    item.twoHanded=Boolean(row.two_handed);
    item.maxDurability=asNumber(row.max_durability);
    item.durability=item.maxDurability;
    item.durabilityUnit=row.durability_unit||'';
    item.material=typeof metadata.material==='string'?metadata.material:null;
    item.materialName=item.material?data.MATERIAL_COLORS[item.material]?.name||'':'';
    item.speedPenalty=asNumber(metadata.speed_penalty);
    item.workEfficiency=asNumber(metadata.work_efficiency);
    item.materialDamageBonuses=metadata.creature_bonus&&typeof metadata.creature_bonus==='object'?metadata.creature_bonus:{};
    item.manaCost=asNumber(metadata.mana_cost);
    item.ammoKey=typeof metadata.ammo==='string'?metadata.ammo:null;
    item.isStackable=Boolean(metadata.stackable);
    item.isKingCrown=Boolean(metadata.is_king_crown);
    item.serverMetadata=metadata;
    item.authoritative=true;
    return item;
  }
  function applyAuthoritativeCatalog(items,rows){
    if(!Array.isArray(rows))throw new Error('O servidor retornou um catálogo de equipamentos inválido.');
    const byId=new Map();
    for(const row of rows){
      const id=String(row?.item_id||'').trim();if(!id)continue;
      if(byId.has(id))throw new Error('O catálogo do servidor contém um identificador duplicado: '+id);
      byId.set(id,row);
    }
    const missing=items.filter(item=>!byId.has(String(item.id)));
    if(missing.length)throw new Error('O catálogo visual contém itens ausentes no banco: '+missing.map(item=>item.id).join(', '));
    items.forEach(item=>applyAuthoritativeItem(item,byId.get(String(item.id))));
    const ids=new Set(items.map(item=>String(item.id)));
    return {ok:true,matched:items.length,serverCount:rows.length,serverOnly:rows.filter(row=>!ids.has(String(row.item_id))).length};
  }
  modules.itemFactory={createItem,applyAuthoritativeCatalog};
})();
