const LPC_ROOT = "https://raw.githubusercontent.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/04140673ec02906f8233523639733c83690df750/spritesheets/";
const FRAME_SIZE = 64;
const BODY_COLUMNS = 9;
const IDLE_COLUMNS = 2;

const SKIN_SOURCE = ["#271920","#99423c","#cc8665","#E4A47C","#F9D5BA","#FAECE7"];
const EYE_SOURCE = ["#5686AE","#57CEE4"];
const SKIN_PALETTES = {
  light:["#271920","#99423c","#cc8665","#E4A47C","#F9D5BA","#FAECE7"],
  amber:["#281716","#9E3E37","#D28144","#EA9F54","#FDD082","#FBE7A4"],
  olive:["#271920","#442725","#7F4C31","#AE6B3F","#D38B59","#E4A47C"],
  taupe:["#271920","#503734","#785946","#936849","#BA8454","#C7935F"],
  bronze:["#1A1213","#442725","#644133","#7F4C31","#AE6B3F","#D38B59"],
  brown:["#120E10","#412B29","#5F4539","#76513A","#9C663E","#B8773F"],
  black:["#000000","#1A1213","#2E1F1C","#442725","#603429","#7F4C31"]
};
const EYE_PALETTES = {
  brown:["#75452A","#B8793F"], blue:["#5686AE","#57CEE4"],
  green:["#39734D","#72B65C"], gray:["#71818B","#B8C2C7"],
  amber:["#A45B1E","#E8A833"], purple:["#7453A2","#B38BDA"]
};
const HAIR_PALETTES = {
  black:["#000000","#080A0A","#101414","#1C2222","#31313E","#4A5057"],
  dark_brown:["#050100","#160701","#290E02","#421603","#5F1F04","#792806"],
  brown:["#1a1213","#2e1f1c","#442725","#603429","#6b3c2e","#7f4c31"],
  chestnut:["#200C0D","#3A130E","#63200B","#81310A","#B6550E","#D28102"],
  ginger:["#300500","#6A1A00","#9C3B01","#CC6901","#FAA301","#FFE01E"],
  blonde:["#331313","#552B15","#AC5D1F","#E09E2B","#FCCF56","#FFE67D"],
  white:["#1D1D21","#484E57","#8B9498","#B8BBBC","#D8DCDC","#FFFFFF"]
};
const imageCache = new Map();
const entries = new Map();

function hexToRgb(hex) {
  const value = String(hex || "").replace("#","");
  if (!/^[0-9a-f]{6}$/i.test(value)) return [231,226,201];
  return [parseInt(value.slice(0,2),16),parseInt(value.slice(2,4),16),parseInt(value.slice(4,6),16)];
}

function makeCanvasCopy(source) {
  const canvas = document.createElement("canvas");
  canvas.width = source.naturalWidth || source.width;
  canvas.height = source.naturalHeight || source.height;
  const context = canvas.getContext("2d",{willReadFrequently:true});
  if (!context || !canvas.width || !canvas.height) throw new Error("Sprite LPC sem dimensões válidas.");
  context.drawImage(source,0,0);
  return {canvas,context};
}

function recolorPalette(source, targetPalette) {
  const copy = makeCanvasCopy(source);
  const pixels = copy.context.getImageData(0,0,copy.canvas.width,copy.canvas.height);
  const target = targetPalette.map(hexToRgb);
  for (let i=0;i<pixels.data.length;i+=4) {
    if (!pixels.data[i+3]) continue;
    const r=pixels.data[i],g=pixels.data[i+1],b=pixels.data[i+2];
    let best=0,bestDistance=Infinity;
    for(let index=0;index<SKIN_SOURCE.length;index++) {
      const rgb=hexToRgb(SKIN_SOURCE[index]);
      const distance=(r-rgb[0])**2+(g-rgb[1])**2+(b-rgb[2])**2;
      if(distance<bestDistance){bestDistance=distance;best=index;}
    }
    const rgb=target[best]||target[0];
    pixels.data[i]=rgb[0];pixels.data[i+1]=rgb[1];pixels.data[i+2]=rgb[2];
  }
  copy.context.putImageData(pixels,0,0);
  return copy.canvas;
}

function recolorFace(source, skinKey, eyeKey) {
  const copy=makeCanvasCopy(source);
  const pixels=copy.context.getImageData(0,0,copy.canvas.width,copy.canvas.height);
  const replacements=new Map();
  [...SKIN_SOURCE.map((color,index)=>[color,SKIN_PALETTES[skinKey][index]]),
   ...EYE_SOURCE.map((color,index)=>[color,(EYE_PALETTES[eyeKey]||EYE_PALETTES.brown)[index]])]
    .forEach(([from,to])=>replacements.set(from.slice(1).toUpperCase(),hexToRgb(to)));
  for(let i=0;i<pixels.data.length;i+=4) {
    if(!pixels.data[i+3]) continue;
    const key=[pixels.data[i],pixels.data[i+1],pixels.data[i+2]]
      .map(value=>value.toString(16).padStart(2,"0")).join("").toUpperCase();
    const rgb=replacements.get(key);
    if(!rgb) continue;
    pixels.data[i]=rgb[0];pixels.data[i+1]=rgb[1];pixels.data[i+2]=rgb[2];
  }
  copy.context.putImageData(pixels,0,0);
  return copy.canvas;
}

function recolorLuminance(source, palette) {
  const copy=makeCanvasCopy(source);
  const pixels=copy.context.getImageData(0,0,copy.canvas.width,copy.canvas.height);
  const colors=palette.map(hexToRgb);
  for(let i=0;i<pixels.data.length;i+=4) {
    if(!pixels.data[i+3]) continue;
    const luminance=(pixels.data[i]*0.299+pixels.data[i+1]*0.587+pixels.data[i+2]*0.114)/255;
    const index=Math.max(0,Math.min(5,Math.round(luminance*5)));
    const rgb=colors[index];
    pixels.data[i]=rgb[0];pixels.data[i+1]=rgb[1];pixels.data[i+2]=rgb[2];
  }
  copy.context.putImageData(pixels,0,0);
  return copy.canvas;
}

function tintPalette(color) {
  const base=hexToRgb(color);
  return [0.32,0.45,0.60,0.76,0.92,1.08].map(factor=>
    "#"+base.map(channel=>Math.max(0,Math.min(255,Math.round(channel*factor))).toString(16).padStart(2,"0")).join("")
  );
}

function recolorHair(source, colorKey) {
  const ramps=window.KTKHairSourcePalettes||[];
  const targets=window.KTKHairPalettes||HAIR_PALETTES;
  if(!ramps.length) return source;
  const copy=makeCanvasCopy(source);
  const pixels=copy.context.getImageData(0,0,copy.canvas.width,copy.canvas.height);
  const rampByColor=new Map();
  ramps.forEach(ramp=>ramp.colors.forEach(color=>{
    const key=parseInt(color.slice(1),16);
    if(!rampByColor.has(key)) rampByColor.set(key,[]);
    rampByColor.get(key).push(ramp.id);
  }));
  const counts=new Map();
  for(let i=0;i<pixels.data.length;i+=4) {
    if(!pixels.data[i+3]) continue;
    const key=(pixels.data[i]<<16)|(pixels.data[i+1]<<8)|pixels.data[i+2];
    if(rampByColor.has(key)) {
      for(const id of rampByColor.get(key)) counts.set(id,(counts.get(id)||0)+1);
    }
  }
  let sourceRamp=ramps[0],best=-1;
  for(const ramp of ramps) {
    const score=counts.get(ramp.id)||0;
    if(score>best){sourceRamp=ramp;best=score;}
  }
  const target=targets[colorKey]||targets.dark_brown;
  const replacements=new Map(sourceRamp.colors.map((color,index)=>[
    parseInt(color.slice(1),16),hexToRgb(target[index]||target[0])
  ]));
  for(let i=0;i<pixels.data.length;i+=4) {
    if(!pixels.data[i+3]) continue;
    const rgb=replacements.get((pixels.data[i]<<16)|(pixels.data[i+1]<<8)|pixels.data[i+2]);
    if(!rgb) continue;
    pixels.data[i]=rgb[0];pixels.data[i+1]=rgb[1];pixels.data[i+2]=rgb[2];
  }
  copy.context.putImageData(pixels,0,0);
  return copy.canvas;
}

function recolorTint(source, color) {
  return recolorLuminance(source,tintPalette(color));
}

function recolorLayer(source, mode, palette, appearance) {
  try {
    if(mode==="skin") return recolorPalette(source,SKIN_PALETTES[appearance.skin]||SKIN_PALETTES.brown);
    if(mode==="face") return recolorFace(source,appearance.skin,appearance.eyes);
    if(mode==="hair") return recolorHair(source,appearance.hair);
    if(mode==="black") return recolorLuminance(source,["#111111","#171717","#202020","#2b2b2b","#3b3b3b","#515151"]);
    if(mode==="tint") return recolorTint(source,palette||appearance.clothing);
  } catch(error) {
    console.warn("KTK V2: não foi possível recolorir um sprite; usando o original.",error);
  }
  return source;
}

function getImage(path,mode,palette,appearance) {
  const appearanceKey = mode === "skin" ? appearance.skin
    : mode === "face" ? appearance.skin + ":" + appearance.eyes
    : mode === "hair" ? appearance.hair
    : mode === "tint" ? (palette || appearance.clothing)
    : (palette || "");
  const key=path+"|"+(mode||"none")+"|"+appearanceKey;
  if(imageCache.has(key)) return imageCache.get(key);
  const promise=new Promise(resolve=>{
    const requested=(path.match(/\/(walk|run|idle)\.png$/)||[])[1]||"walk";
    const motions=[path];
    if(requested!=="walk") motions.push(path.replace(/\/(run|idle)\.png$/,"/walk.png"));
    let sourceIndex=0,attempt=0,settled=false;
    const finish=result=>{if(!settled){settled=true;resolve(result);}};
    const load=()=>{
      const url=LPC_ROOT+motions[sourceIndex];
      const image=new Image();
      image.crossOrigin="anonymous";
      image.onload=()=>{
        try {
          const colored=recolorLayer(image,mode,palette,appearance);
          finish({image:colored,path:motions[sourceIndex],fallbackMotion:sourceIndex>0,missing:false});
        } catch(error) {
          console.warn("KTK V2 sprite decode:",url,error);
          fail();
        }
      };
      image.onerror=fail;
      image.src=url;
    };
    const fail=()=>{
      if(attempt<1){attempt++;setTimeout(load,350);return;}
      attempt=0;sourceIndex++;
      if(sourceIndex<motions.length){load();return;}
      finish({image:null,path,missing:true,fallbackMotion:false});
    };
    load();
  });
  imageCache.set(key,promise);
  void promise.then(result=>{
    if(result?.missing && imageCache.get(key)===promise) imageCache.delete(key);
  });
  return promise;
}

function appearanceDefaults(raw={}) {
  return {
    gender:raw.gender==="female"?"female":"male",
    skin:SKIN_PALETTES[raw.skin]?raw.skin:"brown",
    eyes:EYE_PALETTES[raw.eyes]?raw.eyes:"brown",
    hair:HAIR_PALETTES[raw.hair]?raw.hair:"dark_brown",
    hairstyle:String(raw.hairstyle||"hair_pixie"),
    beard:String(raw.beard||"none"),
    mustache:String(raw.mustache||"none"),
    clothing:/^#[0-9a-f]{6}$/i.test(String(raw.clothing||""))?raw.clothing:"#e7e2c9"
  };
}

function buildDefinitions(rawAppearance, state={}) {
  const appearance=appearanceDefaults(rawAppearance);
  const gender=appearance.gender;
  const lowerGender=gender==="female"?"thin":"male";
  const definitions=[
    {z:0,path:"body/bodies/"+gender+"/walk.png",mode:"skin",name:"corpo",required:true},
    {z:22,path:"legs/pants2/"+lowerGender+"/walk.png",mode:"black",name:"calças",required:true},
    {z:27,path:"feet/shoes/basic/"+lowerGender+"/walk.png",mode:"black",name:"sapatos",required:true},
    {z:65,path:"torso/clothes/shortsleeve/shortsleeve/"+gender+"/walk.png",mode:"tint",palette:appearance.clothing,name:"camisa",required:true},
    {z:100,path:"head/heads/human/"+gender+"/walk.png",mode:"skin",name:"cabeça",required:true},
    {z:105,path:"head/faces/"+gender+"/neutral/walk.png",mode:"face",name:"rosto",required:true}
  ];
  const wearables=state?.wearables&&typeof state.wearables==="object"?state.wearables:{};
  const appearanceLayers=state?.appearance_layers&&typeof state.appearance_layers==="object"?state.appearance_layers:{};
  const slotOrder=["head","chest","waist","legs","feet"];
  for(const slot of slotOrder) {
    const layers=appearanceLayers[slot]||[];
    if(Array.isArray(layers)) {
      layers.forEach(layer=>{
        let path=String(layer.path||"")
          .replaceAll("{gender}",gender)
          .replaceAll("{lowerBodyGender}",lowerGender)
          .replaceAll("{shoeGender}",lowerGender)
          .replaceAll("{armGender}",gender==="female"?"thin":"male");
        if(path) definitions.push({
          z:Number(layer.z)||0,path,mode:layer.mode||null,palette:layer.palette||null,
          name:layer.name||slot,required:true
        });
      });
    }
  }
  const styles=window.KTKHairStyles||[];
  const hairstyle=styles.find(item=>item.id===appearance.hairstyle);
  const fallbackHair=styles.find(item=>item.id==="hair_pixie")||styles[0];
  (hairstyle||fallbackHair)?.layers?.[gender]?.forEach(layer=>definitions.push({
    z:Number(layer.z)||120,path:layer.path,mode:"hair",name:"cabelo",required:true
  }));
  const beard=(window.KTKBeardStyles||[]).find(item=>item.id===appearance.beard);
  (beard?.layers?.[gender]||[]).forEach(layer=>definitions.push({
    z:Number(layer.z)||110,path:layer.path,mode:"hair",name:"barba",required:true
  }));
  const mustache=(window.KTKMustacheStyles||[]).find(item=>item.id===appearance.mustache);
  (mustache?.layers?.[gender]||[]).forEach(layer=>definitions.push({
    z:Number(layer.z)||111,path:layer.path,mode:"hair",name:"bigode",required:true
  }));
  // Wearable records may provide the full LPC appearance layer definition.
  for(const slot of slotOrder) {
    const item=wearables[slot];
    if(!item || !Array.isArray(item.appearanceLayers)) continue;
    item.appearanceLayers.forEach(layer=>{
      const path=String(layer.path||"")
        .replaceAll("{gender}",gender)
        .replaceAll("{lowerBodyGender}",lowerGender)
        .replaceAll("{shoeGender}",lowerGender)
        .replaceAll("{armGender}",gender==="female"?"thin":"male");
      if(path) definitions.push({z:Number(layer.z)||0,path,mode:layer.mode||null,palette:layer.palette||null,name:item.display_name||slot,required:true});
    });
  }
  return definitions.sort((a,b)=>a.z-b.z).map(def=>({...def,appearance}));
}

async function loadSet(definitions,motion,appearance) {
  const results=await Promise.all(definitions.map(async definition=>{
    const path=definition.path.replace(/\/walk\.png$/,"/"+motion+".png");
    const loaded=await getImage(path,definition.mode,definition.palette,appearance);
    return {...loaded,definition,fallbackMotion:loaded.fallbackMotion||loaded.path!==path};
  }));
  return {
    layers:results.filter(item=>item.image&&!item.missing),
    failed:results.filter(item=>item.missing)
  };
}

export class LPCRenderer {
  constructor() {
    this.players=new Map();
    this.retryDelays=[1000,2500,5000,10000,20000,30000];
  }

  ensure(player) {
    const id=String(player?.userId||"");
    if(!id) return null;
    const appearance=appearanceDefaults(player.appearance||{});
    const signature=JSON.stringify({appearance,wearables:player.state?.wearables||{},layers:player.state?.appearance_layers||{}});
    let entry=this.players.get(id);
    if(!entry) {
      entry={signature:"",layers:null,loading:false,retryCount:0,retryTimer:0,elapsed:0,failed:[],latestPlayer:player};
      this.players.set(id,entry);
    }
    entry.latestPlayer=player;
    if(entry.signature!==signature) {
      if(entry.retryTimer) clearTimeout(entry.retryTimer);
      entry.retryTimer=0;
      entry.signature=signature;
      entry.retryCount=0;
      entry.failed=[];
      void this.loadPlayer(id,player,entry,signature);
    }
    return entry;
  }

  async loadPlayer(id,player,entry,signature) {
    if(entry.loading) return;
    entry.loading=true;
    const appearance=appearanceDefaults(player.appearance||{});
    const definitions=buildDefinitions(appearance,player.state||{});
    try {
      const [walk,run,idle]=await Promise.all([
        loadSet(definitions,"walk",appearance),
        loadSet(definitions,"run",appearance),
        loadSet(definitions,"idle",appearance)
      ]);
      if(entry.signature!==signature || this.players.get(id)!==entry) return;
      const failures=[...walk.failed,...run.failed,...idle.failed];
      entry.failed=failures;
      // A full new appearance only replaces the previous one when every layer
      // has loaded (or a motion has a valid walk fallback).
      if(!failures.length && walk.layers.length===definitions.length) {
        entry.layers={walk:walk.layers,run:run.layers,idle:idle.layers};
        entry.retryCount=0;
        if(entry.retryTimer) clearTimeout(entry.retryTimer);
        entry.retryTimer=0;
      } else {
        this.scheduleRetry(id,player,entry,signature);
      }
    } catch(error) {
      console.warn("KTK V2 LPC appearance load:",id,error);
      if(entry.signature===signature) this.scheduleRetry(id,player,entry,signature);
    } finally {
      entry.loading=false;
      if(entry.signature!==signature && this.players.get(id)===entry) {
        void this.loadPlayer(id,entry.latestPlayer,entry,entry.signature);
      }
    }
  }

  scheduleRetry(id,player,entry,signature) {
    if(entry.retryTimer || entry.signature!==signature) return;
    const delay=this.retryDelays[Math.min(entry.retryCount,this.retryDelays.length-1)];
    entry.retryCount++;
    entry.retryTimer=setTimeout(()=>{
      entry.retryTimer=0;
      if(entry.signature===signature && this.players.get(id)===entry) {
        void this.loadPlayer(id,player,entry,signature);
      }
    },delay);
  }

  draw(ctx,player,x,y,deltaSeconds=0) {
    const entry=this.ensure(player);
    if(!entry) return;
    if(!entry.layers) {
      drawClothedFallback(ctx,x,y,player.appearance||{});
      return;
    }
    const moving=Boolean(player.moving||player.state?.moving);
    const running=Boolean(player.running||player.state?.running)&&moving;
    const motion=running?"run":(moving?"walk":"idle");
    const layers=entry.layers[motion]||entry.layers.walk;
    const syncFrameColumns=motion==="idle"?IDLE_COLUMNS:BODY_COLUMNS;
    entry.elapsed=(entry.elapsed||0)+Math.max(0,Number(deltaSeconds)||0);
    const frame=motion==="idle"
      ? Math.floor(entry.elapsed*2)%syncFrameColumns
      : Math.floor(entry.elapsed*(running?12:9))%syncFrameColumns;
    drawLayers(ctx,x,y,layers,player.direction,frame,syncFrameColumns);
  }

  remove(id) {
    const entry=this.players.get(String(id));
    if(entry?.retryTimer) clearTimeout(entry.retryTimer);
    this.players.delete(String(id));
  }

  clear() {
    this.players.forEach(entry=>{if(entry.retryTimer)clearTimeout(entry.retryTimer);});
    this.players.clear();
  }
}

function drawLayers(ctx,x,y,layers,direction,frame,syncFrameColumns) {
  if(!layers?.length) return;
  ctx.save();
  ctx.imageSmoothingEnabled=false;
  for(const layer of layers) {
    const image=layer.image;
    if(!image || !(image.width||image.naturalWidth)) continue;
    const columns=Math.max(1,Math.floor(image.width/FRAME_SIZE));
    const rows=Math.max(1,Math.floor(image.height/FRAME_SIZE));
    const sourceFrame=Number.isInteger(layer.definition.staticFrame)
      ? layer.definition.staticFrame
      : layer.fallbackMotion && syncFrameColumns<=IDLE_COLUMNS && columns>syncFrameColumns
        ? Math.floor(columns/2)
        : Math.round((frame%syncFrameColumns)/syncFrameColumns*columns);
    const row=Math.max(0,Math.min(rows-1,Number(direction)||0));
    const layerFrame=Math.max(0,Math.min(columns-1,sourceFrame));
    const scale=1.28,displaySize=FRAME_SIZE;
    ctx.drawImage(
      image,
      (layerFrame%columns)*FRAME_SIZE,row*FRAME_SIZE,FRAME_SIZE,FRAME_SIZE,
      x-displaySize*scale/2,y-displaySize*scale/2,displaySize*scale,displaySize*scale
    );
  }
  ctx.restore();
}

function drawClothedFallback(ctx,x,y,appearance) {
  // Explicitly clothed placeholder while LPC requests retry; never render a naked player.
  const clothing=String(appearance?.clothing||"#e7e2c9");
  ctx.save();
  ctx.fillStyle="#17201566";
  ctx.beginPath();ctx.ellipse(x,y+12,17,7,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle="#b9a07f";ctx.beginPath();ctx.arc(x,y-10,9,0,Math.PI*2);ctx.fill();
  ctx.fillStyle=clothing;ctx.fillRect(x-10,y-2,20,17);
  ctx.fillStyle="#34343a";ctx.fillRect(x-9,y+13,8,12);ctx.fillRect(x+1,y+13,8,12);
  ctx.fillStyle="#27221d";ctx.fillRect(x-10,y+23,9,4);ctx.fillRect(x+1,y+23,9,4);
  ctx.restore();
}
