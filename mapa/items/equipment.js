/* Inicialização do catálogo visual. Atributos e regras vêm da RPC do servidor. */
(function(){
  'use strict';
  const modules=window.KTKEquipmentModules;
  if(!modules?.data||!modules?.itemRenderer||!modules?.itemFactory||!modules?.wearables||!modules?.itemSpawning)throw new Error('Os módulos de equipamentos não foram carregados na ordem correta.');
  const data=modules.data,factory=modules.itemFactory;
  const sections=data.SECTIONS.map(section=>({
    name:section.name,
    items:section.items.flatMap(definition=>{
      const baseConfig={
        id:'equipment-'+definition.id,displayName:definition.displayName,category:section.name,
        equipmentClass:definition.equipmentClass,sprite:definition.sprite,
        ...(data.ATTACK_ANIMATIONS[definition.id]||{}),...definition.visual
      };
      if(definition.visual.existingLongsword){
        const longsword=window.KTKWorldSword?.entity;
        if(!longsword)throw new Error('A espada inicial não foi carregada antes do catálogo de equipamentos.');
        Object.assign(longsword,{category:section.name,equipmentClass:definition.equipmentClass,
          iconFrameSize:data.FRAME_SIZE,iconSize:36,displayName:definition.displayName,authoritative:false});
        const iconImage=new Image();iconImage.crossOrigin='anonymous';longsword.iconImage=iconImage;
        iconImage.onload=()=>{longsword.iconCanvas=modules.itemRenderer.fitIcon(iconImage,data.FRAME_SIZE);};
        iconImage.onerror=()=>console.warn('Sprite de ícone da espada não encontrado:',definition.sprite);
        iconImage.src=data.SPRITE_ROOT+definition.sprite;
        return [longsword];
      }
      const variant=data.MATERIAL_SPRITE_VARIANTS[definition.id];
      if(!variant)return[factory.createItem(baseConfig)];
      return data.MATERIAL_ORDER.map(material=>{
        const info=data.MATERIAL_COLORS[material];
        return factory.createItem({...baseConfig,...variant.sprites(material),id:'equipment-'+definition.id+'-'+material,
          displayName:info.name+' '+definition.displayName,material,materialName:info.name});
      });
    })
  }));
  sections.push(...modules.wearables.buildWearableSections());
  const items=sections.flatMap(section=>section.items),spawn=modules.itemSpawning.createItemSpawning(items);
  const materials=Object.fromEntries(data.MATERIAL_ORDER.map(m=>[m,{name:data.MATERIAL_COLORS[m].name,color:data.MATERIAL_COLORS[m].hex}]));
  window.KTKEquipmentCatalog={
    items,sections,arrangeFirstMap:spawn.arrangeFirstMap,buildMapWearableDrops:spawn.buildMapWearableDrops,
    materialStats:materials,wearableSlots:modules.wearables.WEARABLE_SLOTS.map(({slot})=>({slot})),
    authoritative:false,authoritySummary:null,
    applyServerCatalog(rows){
      const summary=factory.applyAuthoritativeCatalog(items,rows);
      this.authoritySummary=summary;this.authoritative=true;return summary;
    }
  };
})();
