/* Posicionamento e distribuição inicial dos itens no mundo. */
(function(){
  'use strict';
  function createItemSpawning(items){
    let kingCrownSpawned=false;
    function buildMapWearableDrops(){
      if(kingCrownSpawned)return[];
      const crown=items.find(item=>item.id==='king-crown');if(!crown)return[];
      kingCrownSpawned=true;crown.collected=false;crown.x=0;crown.y=0;return[crown];
    }
    function arrangeFirstMap(width,height,mapItems=[]){
      const safeWidth=Math.max(320,Number(width)||1280),safeHeight=Math.max(320,Number(height)||720);
      const columns=Math.min(5,Math.max(1,mapItems.length)),totalRows=Math.ceil(mapItems.length/columns);
      const xSpacing=Math.max(128,safeWidth*0.18),ySpacing=Math.max(112,safeHeight*0.18);
      mapItems.forEach((item,index)=>{
        const column=index%columns,row=Math.floor(index/columns),isCrown=item.id==='king-crown';
        item.x=isCrown?0:(column-(columns-1)/2)*xSpacing+(Math.random()-0.5)*18;
        item.y=isCrown?0:(row-(totalRows-1)/2)*ySpacing+(Math.random()-0.5)*18;
        item.catalogSection=item.category||'Vestimentas';item.catalogOrder=index;
        item.iconSize=isCrown?48:36;item.displaySize=item.iconSize;
      });
    }
    return {buildMapWearableDrops,arrangeFirstMap};
  }
  window.KTKEquipmentModules.itemSpawning={createItemSpawning};
})();
