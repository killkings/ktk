
(() => {
  'use strict';

  const canvas = document.getElementById('world');
  const ctx = canvas.getContext('2d');
  const preview = document.getElementById('preview');
  const pctx = preview.getContext('2d');
  const screens = {
    welcome: document.getElementById('welcome'),
    creator: document.getElementById('creator'),
    game: document.getElementById('game-ui')
  };

  // Os PNGs são carregados da pasta que fica ao lado deste arquivo HTML.
  const LPC_ROOT = './Universal-LPC-Spritesheet-Character-Generator-master/spritesheets/';
  const FRAME_SIZE = 64;
  const WALK_COLUMNS = 9;
  const WALK_ROWS = 4;
  const IDLE_COLUMNS = 2;
  const WORLD_SCALE = 1.28;
  const PREVIEW_SCALE = 3.5;
  const PUNCH_ANIMATION_SECONDS = 0.42;
  const PUNCH_IMPACT_SECONDS = 0.20;
  const PUNCH_COOLDOWN_SECONDS = 0.5;
  const PUNCH_RANGE = 0.8;
  const PUNCH_STAMINA_COST = 3;
  const KNOCKBACK_SECONDS = 0.24;
  const KNOCKBACK_DISTANCE = 28;
  const KNOCKBACK_HEIGHT = 12;

  const skinPalettes = {
    light:  ['#271920','#99423c','#cc8665','#E4A47C','#F9D5BA','#FAECE7'],
    amber:  ['#281716','#9E3E37','#D28144','#EA9F54','#FDD082','#FBE7A4'],
    olive:  ['#271920','#442725','#7F4C31','#AE6B3F','#D38B59','#E4A47C'],
    taupe:  ['#271920','#503734','#785946','#936849','#BA8454','#C7935F'],
    bronze: ['#1A1213','#442725','#644133','#7F4C31','#AE6B3F','#D38B59'],
    brown:  ['#120E10','#412B29','#5F4539','#76513A','#9C663E','#B8773F'],
    black:  ['#000000','#1A1213','#2E1F1C','#442725','#603429','#7F4C31']
  };
  const skinSource = ['#271920','#99423c','#cc8665','#E4A47C','#F9D5BA','#FAECE7'];
  const eyeSource = ['#5686AE','#57CEE4'];
  const eyePalettes = {
    brown:['#75452A','#B8793F'], blue:['#5686AE','#57CEE4'],
    green:['#39734D','#72B65C'], gray:['#71818B','#B8C2C7'],
    amber:['#A45B1E','#E8A833'], purple:['#7453A2','#B38BDA']
  };
  const hairPalettes = window.KTKHairPalettes;
  const hairSourcePalettes = window.KTKHairSourcePalettes;
  const palettes = {
    skin: [
      {id:'light',name:'Clara',color:'#edc4a7'},
      {id:'amber',name:'Pêssego',color:'#e5a45f'},
      {id:'olive',name:'Oliva',color:'#b67c4d'},
      {id:'taupe',name:'Bege',color:'#bb916f'},
      {id:'bronze',name:'Bronze',color:'#93603e'},
      {id:'brown',name:'Morena',color:'#70452e'},
      {id:'black',name:'Escura',color:'#4a3029'}
    ],
    eyes: [
      {id:'brown',name:'Castanhos',color:'#70452b'},
      {id:'blue',name:'Azuis',color:'#4c94c8'},
      {id:'green',name:'Verdes',color:'#5f9a57'},
      {id:'gray',name:'Cinzentos',color:'#9aa5ad'},
      {id:'amber',name:'Âmbar',color:'#c78a35'},
      {id:'purple',name:'Violetas',color:'#9274bb'}
    ],
    hair: [
      {id:'black',name:'Preto',color:'#241c24'},
      {id:'dark_brown',name:'Castanho-escuro',color:'#503026'},
      {id:'brown',name:'Castanho',color:'#754229'},
      {id:'chestnut',name:'Acaju',color:'#a64e2b'},
      {id:'ginger',name:'Ruivo',color:'#c04b23'},
      {id:'blonde',name:'Loiro',color:'#d6a94e'},
      {id:'white',name:'Branco',color:'#cbc8d0'}
    ]
  };
  palettes.hair.forEach(item=>{ item.color=hairPalettes[item.id][3]; });

  const character = {
    gender:'male', skin:'brown', eyes:'brown', hairstyle:'hair_pixie',
    hair:'dark_brown', beard:'none', mustache:'none'
  };

  let gameStarted = false;
  let equipmentItemsArranged = false;
  let lastTime = 0;
  let walkTime = 0;
  let idleTime = 0;
  let toastTimer = 0;
  let dpr = 1;
  let layerRequestId = 0;
  let currentLayers = [];
  let runLayers = [];
  let idleLayers = [];
  let thrustLayers = [];
  let shootLayers = [];
  let swordLayers = [];
  let swordSlashLayers = [];
  let punchLayers = [];
  let slashLayers = [];
  let previewLayers = [];
  let assetErrors = [];
  let playerMoving = false;
  let playerRunning = false;
  const punch = {active:false,elapsed:0,cooldown:0,direction:2,hitApplied:false,weaponAttack:false,weaponItem:null,range:PUNCH_RANGE,attackBonus:0};
  let fileColorFallback = false;
  const imageCache = new Map();
  const damageTintCache = new WeakMap();
  const keys = new Set();
  let leftMouseHeld = false;
  const player = {x:0,y:0,direction:2,knockback:null,knockbackHeight:0};
  // Posição fixa no mundo: não acompanha o deslocamento do jogador.
  const camera = {x:0,y:0};
  const TILE = 72;
  const SPEED = 225;
  const COLLISION_RADIUS = 18;
  const remotePlayers = new Map();
  const inventory = [null, null];
  let selectedInventorySlot = 0;
  const worldItems = new Set(window.KTKEquipmentCatalog.items);
  window.KTKPlayerStats.setEquipmentAttackBonusProvider(() => {
    const selectedItem=inventory[selectedInventorySlot];
    return Math.max(0,Number(selectedItem?.attackBonus)||0);
  });
  window.KTKPlayerStats.setEquipmentDefenseMultiplierProvider(() => {
    const selectedItem=inventory[selectedInventorySlot];
    return leftMouseHeld && selectedItem?.equipmentClass==='shield' ? 2 : 1;
  });

  function showScreen(which) {
    screens.welcome.classList.toggle('active', which === 'welcome');
    screens.creator.classList.toggle('active', which === 'creator');
    screens.game.classList.toggle('active', which === 'game');
    if (which === 'game') resize();
  }

  function colorButtons(group, targetId, labelId) {
    const holder = document.getElementById(targetId);
    holder.innerHTML = '';
    const selectedId = character[group];
    palettes[group].forEach(item => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'swatch' + (selectedId === item.id ? ' selected' : '');
      btn.style.background = item.color;
      btn.title = item.name;
      btn.setAttribute('aria-label', item.name);
      btn.addEventListener('click', () => {
        character[group] = item.id;
        updateCreator();
      });
      holder.appendChild(btn);
    });
    const selected = palettes[group].find(item => item.id === selectedId);
    document.getElementById(labelId).textContent = selected ? selected.name : '';
  }

  function populateOptions(selectId, options) {
    const select=document.getElementById(selectId);
    select.innerHTML='';
    options.forEach(([value,label])=>{
      const option=document.createElement('option');
      option.value=value;
      option.textContent=label;
      select.appendChild(option);
    });
  }

  function populateCatalogOptions(selectId, catalog, selectedId, fallbackId) {
    const available=catalog.filter(item=>item.availableFor.includes(character.gender));
    const selection=available.some(item=>item.id===selectedId)
      ? selectedId
      : (available.find(item=>item.id===fallbackId)?.id || available[0]?.id || '');
    const select=document.getElementById(selectId);
    populateOptions(selectId,available.map(item=>[item.id,item.name]));
    select.value=selection;
    available.forEach((item,index)=>{
      const layers=item.layers[character.gender] || [];
      const paths=layers.map(layer=>layer.path).join(' + ');
      select.options[index].title=item.sourceName+
        (item.definition?' · '+item.definition:'')+
        (paths?' · '+paths:' · sem camada de sprite');
    });
    return selection;
  }

  function updateCreatorControls() {
    colorButtons('skin','skin-swatches','skin-name');
    colorButtons('eyes','eye-swatches','eye-name');
    colorButtons('hair','hair-swatches','hair-name');
    document.getElementById('gender-name').textContent = character.gender === 'male' ? 'Masculino' : 'Feminino';
    document.querySelectorAll('[data-gender]').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.gender === character.gender);
    });
    character.hairstyle=populateCatalogOptions(
      'hairstyle-select',window.KTKHairStyles,character.hairstyle,'hair_pixie'
    );
    character.beard=populateCatalogOptions(
      'beard-select',window.KTKBeardStyles,character.beard,'none'
    );
    character.mustache=populateCatalogOptions(
      'mustache-select',window.KTKMustacheStyles,character.mustache,'none'
    );
    const hairstyle=window.KTKHairStyles.find(item=>item.id===character.hairstyle);
    document.getElementById('style-name').textContent = hairstyle ? hairstyle.name : '';
  }

  function nearestPaletteIndex(r, g, b, source) {
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let i=0; i<source.length; i++) {
      const hex = source[i];
      const sr = parseInt(hex.slice(1,3),16);
      const sg = parseInt(hex.slice(3,5),16);
      const sb = parseInt(hex.slice(5,7),16);
      const distance = (r-sr)*(r-sr) + (g-sg)*(g-sg) + (b-sb)*(b-sb);
      if (distance < bestDistance) { bestDistance = distance; bestIndex = i; }
    }
    return bestIndex;
  }

  function hexToRgb(hex) {
    return [parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)];
  }

  const hairColorSources=new Map();
  hairSourcePalettes.forEach(ramp=>ramp.colors.forEach((hex,index)=>{
    const key=parseInt(hex.slice(1),16);
    if(!hairColorSources.has(key)) hairColorSources.set(key,[]);
    hairColorSources.get(key).push({id:ramp.id,index});
  }));

  function recolorHair(imageCanvas,paletteKey) {
    const c=document.createElement('canvas');
    c.width=imageCanvas.width; c.height=imageCanvas.height;
    const g=c.getContext('2d',{willReadFrequently:true});
    g.drawImage(imageCanvas,0,0);
    const image=g.getImageData(0,0,c.width,c.height);
    const colorCounts=new Map();
    for(let i=0;i<image.data.length;i+=4) {
      if(image.data[i+3]===0) continue;
      const key=(image.data[i]<<16)|(image.data[i+1]<<8)|image.data[i+2];
      if(hairColorSources.has(key)) colorCounts.set(key,(colorCounts.get(key)||0)+1);
    }
    const scores=new Map();
    colorCounts.forEach((count,key)=>hairColorSources.get(key).forEach(source=>
      scores.set(source.id,(scores.get(source.id)||0)+count)
    ));
    let sourceId='ulpc:orange',bestScore=-1;
    for(const ramp of hairSourcePalettes) {
      const score=scores.get(ramp.id)||0;
      if(score>bestScore) {sourceId=ramp.id;bestScore=score;}
    }
    const source=hairSourcePalettes.find(ramp=>ramp.id===sourceId)||hairSourcePalettes[0];
    const target=hairPalettes[paletteKey]||hairPalettes.dark_brown;
    const replacements=new Map(source.colors.map((hex,index)=>[
      parseInt(hex.slice(1),16),hexToRgb(target[index])
    ]));
    for(let i=0;i<image.data.length;i+=4) {
      if(image.data[i+3]===0) continue;
      const rgb=replacements.get((image.data[i]<<16)|(image.data[i+1]<<8)|image.data[i+2]);
      if(!rgb) continue;
      image.data[i]=rgb[0]; image.data[i+1]=rgb[1]; image.data[i+2]=rgb[2];
    }
    g.putImageData(image,0,0);
    return c;
  }

  function recolorPalette(imageCanvas, sourcePalette, targetPalette) {
    const c = document.createElement('canvas');
    c.width = imageCanvas.width; c.height = imageCanvas.height;
    const g = c.getContext('2d',{willReadFrequently:true});
    g.drawImage(imageCanvas,0,0);
    const image = g.getImageData(0,0,c.width,c.height);
    const targetRgb = targetPalette.map(hexToRgb);
    for (let i=0; i<image.data.length; i+=4) {
      if (image.data[i+3] === 0) continue;
      const idx = nearestPaletteIndex(image.data[i],image.data[i+1],image.data[i+2],sourcePalette);
      const rgb = targetRgb[idx];
      image.data[i]=rgb[0]; image.data[i+1]=rgb[1]; image.data[i+2]=rgb[2];
    }
    g.putImageData(image,0,0);
    return c;
  }

  function recolorFace(imageCanvas, skinPalette, eyesPalette) {
    const c=document.createElement('canvas');
    c.width=imageCanvas.width; c.height=imageCanvas.height;
    const g=c.getContext('2d',{willReadFrequently:true});
    g.drawImage(imageCanvas,0,0);
    const image=g.getImageData(0,0,c.width,c.height);
    const replacements=new Map();
    [...skinSource.map((source,index)=>[source,skinPalette[index]]),
      ...eyeSource.map((source,index)=>[source,eyesPalette[index]])]
      .forEach(([source,target])=>replacements.set(source.slice(1).toUpperCase(),hexToRgb(target)));
    for(let i=0;i<image.data.length;i+=4) {
      if(image.data[i+3]===0) continue;
      const key=[image.data[i],image.data[i+1],image.data[i+2]]
        .map(value=>value.toString(16).padStart(2,'0')).join('').toUpperCase();
      const rgb=replacements.get(key);
      if(!rgb) continue;
      image.data[i]=rgb[0]; image.data[i+1]=rgb[1]; image.data[i+2]=rgb[2];
    }
    g.putImageData(image,0,0);
    return c;
  }

  function recolorByLuminance(imageCanvas, targetPalette) {
    const c = document.createElement('canvas');
    c.width = imageCanvas.width; c.height = imageCanvas.height;
    const g = c.getContext('2d',{willReadFrequently:true});
    g.drawImage(imageCanvas,0,0);
    const image = g.getImageData(0,0,c.width,c.height);
    const targetRgb = targetPalette.map(hexToRgb);
    for (let i=0; i<image.data.length; i+=4) {
      if (image.data[i+3] === 0) continue;
      const lum = (image.data[i]*0.299 + image.data[i+1]*0.587 + image.data[i+2]*0.114) / 255;
      const idx = Math.max(0,Math.min(5,Math.round(lum*5)));
      const rgb = targetRgb[idx];
      image.data[i]=rgb[0]; image.data[i+1]=rgb[1]; image.data[i+2]=rgb[2];
    }
    g.putImageData(image,0,0);
    return c;
  }

  function recolorBlack(imageCanvas) {
    return recolorByLuminance(imageCanvas, ['#111111','#171717','#202020','#2b2b2b','#3b3b3b','#515151']);
  }

  function loadLayer(path, recolorMode, paletteKey) {
    const cacheKey = `${path}|${recolorMode || 'none'}|${paletteKey || ''}`;
    if (imageCache.has(cacheKey)) return imageCache.get(cacheKey);
    const promise = new Promise(resolve => {
      const img = new Image();
      let actualPath=path;
      let triedWalkFallback=false;
      img.onload = () => {
        const original = document.createElement('canvas');
        original.width = img.naturalWidth;
        original.height = img.naturalHeight;
        const g = original.getContext('2d',{willReadFrequently:true});
        g.drawImage(img,0,0);
        let finalImage = original;
        try {
          if (recolorMode === 'skin') finalImage = recolorPalette(original,skinSource,skinPalettes[paletteKey] || skinPalettes.brown);
          else if (recolorMode === 'face') {
            const [skinKey,eyeKey]=paletteKey.split(':');
            finalImage = recolorFace(original,skinPalettes[skinKey] || skinPalettes.brown,eyePalettes[eyeKey] || eyePalettes.brown);
          }
          else if (recolorMode === 'hair') finalImage = recolorHair(original,paletteKey);
          else if (recolorMode === 'black') finalImage = recolorBlack(original);
        } catch (error) {
          fileColorFallback = true;
          console.warn('Personalização de cores indisponível nesta origem; usando os sprites originais.',error);
          finalImage = original;
        }
        resolve({image:finalImage,path:actualPath,missing:false});
      };
      img.onerror = () => {
        if (!triedWalkFallback && /\/(?:run|idle|thrust|shoot|halfslash|slash)\.png$/.test(path)) {
          triedWalkFallback=true;
          actualPath=path.replace(/\/(?:run|idle|thrust|shoot|halfslash|slash)\.png$/,'/walk.png');
          img.src=LPC_ROOT+actualPath;
          return;
        }
        resolve({image:null,path,missing:true});
      };
      img.src = LPC_ROOT + path;
    });
    imageCache.set(cacheKey,promise);
    return promise;
  }

  function buildLayerDefinitions() {
    const gender=character.gender;
    const pantsGender=gender==='female'?'thin':'male';
    const shoeGender=gender==='female'?'thin':'male';
    const layers=[
      {z:0,path:'body/bodies/'+gender+'/walk.png',mode:'skin',palette:character.skin,name:'corpo'},
      {z:20,path:'legs/pants2/'+pantsGender+'/walk.png',mode:'black',name:'calca'},
      {z:25,path:'feet/shoes/basic/'+shoeGender+'/walk.png',mode:'black',name:'tenis'},
      {z:60,path:'torso/clothes/shortsleeve/shortsleeve/'+gender+'/walk.png',mode:null,name:'camisa'},
      {z:100,path:'head/heads/human/'+gender+'/walk.png',mode:'skin',palette:character.skin,name:'cabeca'},
      {z:105,path:'head/faces/'+gender+'/neutral/walk.png',mode:'face',palette:character.skin+':'+character.eyes,name:'rosto'}
    ];
    const beard=window.KTKBeardStyles.find(item=>item.id===character.beard);
    (beard?.layers[gender] || []).forEach(layer=>layers.push({
      z:layer.z,path:layer.path,mode:'hair',palette:character.hair,name:'barba'
    }));
    const mustache=window.KTKMustacheStyles.find(item=>item.id===character.mustache);
    (mustache?.layers[gender] || []).forEach(layer=>layers.push({
      z:layer.z,path:layer.path,mode:'hair',palette:character.hair,name:'bigode'
    }));
    const hairstyle=window.KTKHairStyles.find(item=>item.id===character.hairstyle);
    (hairstyle?.layers[gender] || []).forEach(hair=>layers.push({
      z:hair.z,path:hair.path,mode:'hair',palette:character.hair,name:'cabelo'
    }));
    return layers.sort((a,b)=>a.z-b.z);
  }

  async function rebuildCharacterLayers() {
    const requestId = ++layerRequestId;
    assetErrors = [];
    document.getElementById('asset-status').textContent = 'Carregando os sprites do LPC…';
    const definitions = buildLayerDefinitions();
    const runDefinitions = definitions.map(def=>({...def,path:def.path.replace(/\/walk\.png$/,'/run.png')}));
    const idleDefinitions = definitions.map(def=>({...def,path:def.path.replace(/\/walk\.png$/,'/idle.png')}));
    const punchDefinitions = definitions.map(def=>({...def,path:def.path.replace(/\/walk\.png$/,'/halfslash.png')}));
    const slashDefinitions = definitions.map(def=>({...def,path:def.path.replace(/\/walk\.png$/,'/slash.png')}));
    const thrustDefinitions = definitions.map(def=>({...def,path:def.path.replace(/\/walk\.png$/,'/thrust.png')}));
    const shootDefinitions = definitions.map(def=>({...def,path:def.path.replace(/\/walk\.png$/,'/shoot.png')}));
    const swordDefinitions = [
      {z:-10,path:'weapon/sword/longsword/universal_behind/walk/longsword.png'},
      {z:70,path:'weapon/sword/longsword/walk/longsword.png'}
    ];
    const swordSlashDefinitions = [
      {z:-1,frameSize:192,path:'weapon/sword/longsword/attack_slash/behind/longsword.png'},
      {z:150,frameSize:192,path:'weapon/sword/longsword/attack_slash/longsword.png'}
    ];
    const [loaded,loadedRun,loadedIdle,loadedPunch,loadedSlash,loadedThrust,loadedShoot,loadedSword,loadedSwordSlash] = await Promise.all([Promise.all(definitions.map(def =>
      loadLayer(def.path,def.mode,def.palette).then(result => ({...result,definition:def}))
    )),Promise.all(runDefinitions.map(def =>
      loadLayer(def.path,def.mode,def.palette).then(result => ({...result,definition:def}))
    )),Promise.all(idleDefinitions.map(def =>
      loadLayer(def.path,def.mode,def.palette).then(result => ({...result,definition:def}))
    )),Promise.all(punchDefinitions.map(def =>
      loadLayer(def.path,def.mode,def.palette).then(result => ({...result,definition:def}))
    )),Promise.all(slashDefinitions.map(def =>
      loadLayer(def.path,def.mode,def.palette).then(result => ({...result,definition:def}))
    )),Promise.all(thrustDefinitions.map(def =>
      loadLayer(def.path,def.mode,def.palette).then(result => ({...result,definition:def}))
    )),Promise.all(shootDefinitions.map(def =>
      loadLayer(def.path,def.mode,def.palette).then(result => ({...result,definition:def}))
    )),Promise.all(swordDefinitions.map(def =>
      loadLayer(def.path,null,null).then(result => ({...result,definition:def}))
    )),Promise.all(swordSlashDefinitions.map(def =>
      loadLayer(def.path,null,null).then(result => ({...result,definition:def}))
    ))]);
    if (requestId !== layerRequestId) return;
    currentLayers = loaded.filter(layer => layer.image && !layer.missing);
    runLayers = loadedRun.filter(layer => layer.image && !layer.missing);
    idleLayers = loadedIdle.filter(layer => layer.image && !layer.missing);
    punchLayers = loadedPunch.filter(layer => layer.image && !layer.missing);
    slashLayers = loadedSlash.filter(layer => layer.image && !layer.missing);
    thrustLayers = loadedThrust.filter(layer => layer.image && !layer.missing);
    shootLayers = loadedShoot.filter(layer => layer.image && !layer.missing);
    swordLayers = loadedSword.filter(layer => layer.image && !layer.missing)
      .map(layer=>({...layer,z:layer.definition.z}));
    swordSlashLayers = loadedSwordSlash.filter(layer=>layer.image && !layer.missing)
      .map(layer=>({...layer,z:layer.definition.z,frameSize:layer.definition.frameSize}));
    assetErrors = [...loaded,...loadedSlash,...loadedThrust,...loadedShoot,...loadedSwordSlash]
      .filter(layer => layer.missing)
      .map(layer => (layer.definition.name||'ataque') + ': ' + layer.path);
    previewLayers = currentLayers;
    if (assetErrors.length) {
      const shortList = assetErrors.slice(0,3).join(' · ');
      document.getElementById('asset-status').textContent = `Alguns arquivos não foram encontrados: ${shortList}`;
      console.warn('Arquivos LPC não encontrados:',assetErrors);
    } else {
      document.getElementById('asset-status').textContent = fileColorFallback && location.protocol === 'file:'
        ? 'Sprites carregados; use servidor local para personalizar as cores'
        : 'Sprites LPC carregados · prévia animada ao caminhar e correr';
    }
    drawPreview();
  }

  function drawLayeredCharacter(g, x, y, layers, scale, direction, frame, damaged=false) {
    if (!layers || !layers.length) return;
    g.save();
    g.imageSmoothingEnabled = false;
    layers.forEach(layer => {
      if (!layer.image) return;
      if (!(layer.image.naturalWidth || layer.image.width)) return;
      const sprite=damaged?getDamageTintedSprite(layer.image):layer.image;
      const size=layer.frameSize||FRAME_SIZE;
      const columns=Math.max(1,Math.floor(sprite.width/size));
      const rows=Math.max(1,Math.floor(sprite.height/size));
      const sourceFrame=Number.isInteger(layer.staticFrame)?layer.staticFrame:frame;
      const left=x-(size/2)*scale;
      const top=y-(size/2)*scale;
      g.drawImage(
        sprite,
        (sourceFrame%columns)*size,(direction%rows)*size,size,size,
        left,top,size*scale,size*scale
      );
    });
    g.restore();
  }

  function drawGroundShadow(g,x,y,rx,ry,opacity=.34) {
    g.save();
    g.fillStyle=`rgba(12,18,11,${opacity})`;
    g.beginPath();
    g.ellipse(x+2,y,rx,ry,0,0,Math.PI*2);
    g.fill();
    g.restore();
  }

  function drawWorldItemLabel(g,item,x,y) {
    const text=`${item.category}: ${item.displayName}`;
    g.save();
    g.font='10px system-ui';
    g.textAlign='center';
    g.textBaseline='middle';
    const width=Math.min(220,Math.max(90,g.measureText(text).width+14));
    const labelX=Math.max(width/2+6,Math.min(canvas.clientWidth-width/2-6,x));
    const labelY=Math.max(12,Math.min(canvas.clientHeight-12,y-(item.iconSize||item.displaySize||38)/2-12));
    g.fillStyle='rgba(13,22,15,.88)';
    g.fillRect(labelX-width/2,labelY-9,width,18);
    g.strokeStyle='rgba(223,235,196,.65)';
    g.lineWidth=1;
    g.strokeRect(labelX-width/2+.5,labelY-8.5,width-1,17);
    g.fillStyle='#f2f5e7';
    g.fillText(text,labelX,labelY,width-10);
    g.restore();
  }

  function getDamageTintedSprite(image) {
    if(damageTintCache.has(image)) return damageTintCache.get(image);
    const tinted=document.createElement('canvas');
    tinted.width=image.width;
    tinted.height=image.height;
    const tintContext=tinted.getContext('2d');
    tintContext.drawImage(image,0,0);
    tintContext.globalCompositeOperation='source-in';
    tintContext.fillStyle='#ff2626';
    tintContext.fillRect(0,0,tinted.width,tinted.height);
    damageTintCache.set(image,tinted);
    return tinted;
  }

  function getPlayerLayers(baseLayers, weaponMode='held') {
    const selectedItem=weaponMode==='attack'
      ? (punch.weaponItem||inventory[selectedInventorySlot])
      : inventory[selectedInventorySlot];

    if(weaponMode==='none'||!selectedItem||selectedItem.itemType==='ammo') return baseLayers;

    if(selectedItem.id==='longsword-1') {
      const itemLayers=weaponMode==='attack'?swordSlashLayers:swordLayers;
      return [...baseLayers,...itemLayers].sort((a,b)=>(a.z??a.definition?.z??0)-(b.z??b.definition?.z??0));
    }

    const image=weaponMode==='attack'&&selectedItem.attackImage?.naturalWidth
      ? selectedItem.attackImage
      : selectedItem.image;
    if(!image?.naturalWidth) return baseLayers;

    const frameSize=weaponMode==='attack'
      ? (selectedItem.attackFrameSize||selectedItem.heldFrameSize||FRAME_SIZE)
      : (selectedItem.heldFrameSize||FRAME_SIZE);
    const staticFrame=weaponMode==='held'&&Number.isInteger(selectedItem.heldStaticFrame)
      ? selectedItem.heldStaticFrame
      : undefined;
    const backgroundImage=weaponMode==='attack'
      ? (selectedItem.attackBackgroundImage||selectedItem.heldBackgroundImage)
      : selectedItem.heldBackgroundImage;
    const z=Number(selectedItem.equipmentZ??150);
    const itemLayers=[];
    if(backgroundImage?.naturalWidth) itemLayers.push({image:backgroundImage,frameSize,z:-1,staticFrame});
    itemLayers.push({image,frameSize,z,staticFrame});

    return [...baseLayers,...itemLayers].sort((a,b)=>(a.z??a.definition?.z??0)-(b.z??b.definition?.z??0));
  }


  function drawPreview() {
    pctx.clearRect(0,0,preview.width,preview.height);
    if (!previewLayers.length) {
      pctx.fillStyle = 'rgba(255,255,255,.8)';
      pctx.font = '13px system-ui';
      pctx.textAlign = 'center';
      pctx.fillText('Carregando personagem…',165,168);
      return;
    }
    drawLayeredCharacter(pctx,165,165,previewLayers,PREVIEW_SCALE,2,0);
  }

  function updateCreator() {
    updateCreatorControls();
    rebuildCharacterLayers();
  }

  function hash2(x,y) {
    let n = Math.imul(x ^ 0x9e3779b9,0x85ebca6b) ^ Math.imul(y ^ 0xc2b2ae35,0x27d4eb2f);
    n = Math.imul(n ^ (n >>> 16),0x7feb352d);
    n = Math.imul(n ^ (n >>> 15),0x846ca68b);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  }

  const grassTileCache = new Map();
  function makeGrassTile(tx,ty) {
    const key = `${tx},${ty}`;
    if (grassTileCache.has(key)) return grassTileCache.get(key);
    const tile = document.createElement('canvas');
    tile.width=TILE; tile.height=TILE;
    const t=tile.getContext('2d');
    const seed=hash2(tx,ty);
    t.fillStyle='#67964f'; t.fillRect(0,0,TILE,TILE);
    const shade=Math.floor(seed*11);
    t.fillStyle=`rgba(${24+shade},${76+shade},${31+Math.floor(shade*.45)},${0.025+seed*.035})`;
    t.fillRect(0,0,TILE,TILE);
    const count=11+Math.floor(seed*10);
    for(let i=0;i<count;i++) {
      const r1=hash2(tx*31+i*7,ty*19-i*13);
      const r2=hash2(tx*17-i*11,ty*29+i*5);
      const x=5+r1*(TILE-10);
      const y=5+r2*(TILE-10);
      const len=3.5+hash2(tx+i,ty-i)*5.5;
      const lean=(hash2(tx-i*3,ty+i*2)-.5)*5;
      t.lineWidth=1+r1*.45;
      t.lineCap='round';
      t.strokeStyle=r2>.52?'rgba(31,91,42,.31)':'rgba(202,224,135,.25)';
      t.beginPath(); t.moveTo(x,y+len*.35); t.quadraticCurveTo(x+lean*.25,y-len*.2,x+lean,y-len); t.stroke();
      if(i%4===0) {
        t.strokeStyle='rgba(219,231,160,.19)'; t.lineWidth=.8;
        t.beginPath(); t.moveTo(x-2,y+1); t.lineTo(x-2.8,y-len*.48); t.stroke();
      }
    }
    if(seed>.72) {
      t.fillStyle='rgba(190,214,125,.035)';
      t.beginPath(); t.ellipse(TILE*.5,TILE*.5,18+seed*10,12+seed*8,seed*2,0,Math.PI*2); t.fill();
    }
    grassTileCache.set(key,tile);
    if(grassTileCache.size>1200) grassTileCache.delete(grassTileCache.keys().next().value);
    return tile;
  }

  function drawGrass(g,left,top,width,height) {
    g.fillStyle='#67964f'; g.fillRect(0,0,width,height);
    const minX=Math.floor(left/TILE)-1;
    const maxX=Math.floor((left+width)/TILE)+1;
    const minY=Math.floor(top/TILE)-1;
    const maxY=Math.floor((top+height)/TILE)+1;
    for(let ty=minY;ty<=maxY;ty++) {
      for(let tx=minX;tx<=maxX;tx++) g.drawImage(makeGrassTile(tx,ty),tx*TILE-left,ty*TILE-top);
    }
  }

  function resize() {
    const rect=canvas.getBoundingClientRect();
    dpr=Math.min(window.devicePixelRatio||1,2);
    canvas.width=Math.max(1,Math.floor(rect.width*dpr));
    canvas.height=Math.max(1,Math.floor(rect.height*dpr));
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }

  function render(now) {
    // Agenda o próximo frame antes do desenho: uma falha isolada não congela o jogo.
    requestAnimationFrame(render);
    const w=canvas.clientWidth, h=canvas.clientHeight;
    if(!w||!h) return;
    const dt=Math.min((now-lastTime)/1000||0,.04);
    lastTime=now;
    const inWorld=gameStarted&&screens.game.classList.contains('active');
    ctx.clearRect(0,0,w,h);
    if(!inWorld) return;

    try {
      update(dt,w,h);
      if(window.KTKWorldMap) window.KTKWorldMap.setViewport(w,h);

      // camera.x/y identificam a sala. O retângulo desenhado é sempre uma tela 16:9.
      const camX=camera.x*w-w/2;
      const camY=camera.y*h-h/2;
      if(window.KTKWorldMap && typeof window.KTKWorldMap.draw==='function') {
        window.KTKWorldMap.draw(ctx,camX,camY,w,h,window.KTKWorldMap.tileSize);
      } else {
        drawGrass(ctx,camX,camY,w,h);
      }

      const attackFrameCount=Math.max(1,Number(punch.weaponItem?.attackFrameCount)||6);
      const frame=punch.active
        ? Math.min(attackFrameCount-1,Math.floor((punch.elapsed/PUNCH_ANIMATION_SECONDS)*attackFrameCount))
        : playerMoving?Math.floor(walkTime*10)%WALK_COLUMNS:Math.floor(idleTime*2)%IDLE_COLUMNS;
      const renderables=[
        ...getWorldEntities().map(entity=>({entity,depth:entity.y})),
        {entity:{type:'local-player'},depth:camera.y*h+player.y}
      ].sort((a,b)=>a.depth-b.depth);
      const playerWorldX=camera.x*w+player.x;
      const playerWorldY=camera.y*h+player.y;
      let focusedItem=null;
      let focusedItemDistance=80;
      worldItems.forEach(item=>{
        if(item.collected) return;
        const distance=Math.hypot(playerWorldX-item.x,playerWorldY-item.y);
        if(distance<focusedItemDistance) {
          focusedItemDistance=distance;
          focusedItem=item;
        }
      });
      renderables.forEach(({entity})=>{
        const localPlayer=entity.type==='local-player';
        const screenX=localPlayer?player.x+w/2:entity.x-camera.x*w+w/2;
        const screenY=localPlayer?player.y+h/2:entity.y-camera.y*h+h/2;
        if(entity.type==='local-player'||entity.type==='player') drawGroundShadow(ctx,screenX,screenY+33,17,7,.34);
        else if(entity.type==='enemy') drawGroundShadow(ctx,screenX,screenY+33,18,7,.36);
        else if(entity.type==='item') drawGroundShadow(ctx,screenX,screenY+15,14,5,.28);
        if(entity.type==='local-player') {
          const weaponAttackLayers=punch.weaponItem?.attackType==='thrust'
            ? thrustLayers
            : punch.weaponItem?.attackType==='shoot'?shootLayers:slashLayers;
          const baseLayers=punch.active
            ? (punch.weaponAttack
              ? (weaponAttackLayers.length?weaponAttackLayers:currentLayers)
              : (punchLayers.length?punchLayers:currentLayers))
            : playerMoving?(playerRunning?runLayers:currentLayers):idleLayers;
          const direction=punch.active?punch.direction:player.direction;
          const weaponMode=punch.active?(punch.weaponAttack?'attack':'none'):'held';
          drawLayeredCharacter(ctx,screenX,screenY-(player.knockbackHeight||0),getPlayerLayers(baseLayers,weaponMode),WORLD_SCALE,direction,frame,Boolean(player.knockback));
          return;
        }
        if(entity.type==='enemy' && entity.id==='skeleton-1') {
          window.KTKEnemySkeleton.draw(ctx,screenX,screenY,idleTime);
        } else if(entity.type==='enemy' && entity.layers) {
          drawLayeredCharacter(ctx,screenX,screenY-(entity.knockbackHeight||0),entity.layers,WORLD_SCALE,Number.isFinite(entity.direction)?entity.direction:2,entity.frame||0,Boolean(entity.knockback));
        } else if(entity.type==='item') {
          if(entity.id==='longsword-1') window.KTKWorldSword.draw(ctx,screenX,screenY);
          else drawWorldItem(ctx,entity,screenX,screenY);
          if(entity===focusedItem) drawWorldItemLabel(ctx,entity,screenX,screenY);
        } else if(entity.type==='player') {
          drawLayeredCharacter(ctx,screenX,screenY-(entity.knockbackHeight||0),entity.layers,WORLD_SCALE,entity.direction,0,Boolean(entity.knockback));
        }
      });
      updateSkeletonStatsPosition(w,h);

      const region=window.KTKWorldMap?.regionAt(camera.x*w+player.x,camera.y*h+player.y);
      document.getElementById('coords').textContent=region
        ? `${region.name} · ${region.subregion} · X${region.x} Y${region.y}`
        : `Sala X${camera.x+1} Y${camera.y+1}`;
    } catch(error) {
      console.error('Erro ao desenhar o mapa do Kill the King:',error);
      // Fallback visível para que um erro no mapa nunca deixe a tela totalmente vazia.
      ctx.save();
      ctx.fillStyle='#67964f';
      ctx.fillRect(0,0,w,h);
      ctx.fillStyle='rgba(15,34,24,.82)';
      ctx.fillRect(18,72,Math.min(w-36,540),58);
      ctx.fillStyle='#ffffff';
      ctx.font='bold 14px system-ui';
      ctx.fillText('Falha ao desenhar o mapa. Consulte o console (F12).',30,105);
      ctx.restore();
      document.getElementById('coords').textContent='Erro no mapa — veja o console';
    }
  }

  function update(dt,roomWidth,roomHeight) {
    idleTime+=dt;
    updatePunch(dt);
    let dx=0,dy=0;
    if(keys.has('w')||keys.has('arrowup')) dy-=1;
    if(keys.has('s')||keys.has('arrowdown')) dy+=1;
    if(keys.has('a')||keys.has('arrowleft')) dx-=1;
    if(keys.has('d')||keys.has('arrowright')) dx+=1;
    playerMoving=dx!==0||dy!==0;
    const movement=window.KTKPlayerStats.updateStamina(dt,playerMoving,keys.has('shift'));
    playerRunning=movement.running;
    if(playerMoving) {
      const magnitude=Math.hypot(dx,dy);
      dx/=magnitude; dy/=magnitude;
      movePlayerWithCollisions(dx*SPEED*(movement.speed/2)*dt,dy*SPEED*(movement.speed/2)*dt);
      // O LPC possui quatro linhas direcionais; diagonais usam o eixo dominante.
      if(Math.abs(dx)>Math.abs(dy)) player.direction=dx>0?3:1;
      else player.direction=dy>0?2:0;
      walkTime+=dt;
    } else {
      walkTime=0;
    }
    const halfW=roomWidth/2,halfH=roomHeight/2;
    // A sala ocupa exatamente a área visível do canvas 16:9.
    if(player.x>=halfW){player.x=-halfW+2;camera.x++;}
    else if(player.x<=-halfW){player.x=halfW-2;camera.x--;}
    if(player.y>=halfH){player.y=-halfH+2;camera.y++;}
    else if(player.y<=-halfH){player.y=halfH-2;camera.y--;}
    updateKnockbacks(dt);
    updateEnemyCombat(dt);
  }

  function getWorldEntities() {
    const skeleton=window.KTKEnemySkeleton.entity;
    const entities=skeleton.defeated?[]:[skeleton];
    worldItems.forEach(item=>{if(!item.collected) entities.push(item);});
    remotePlayers.forEach(remote=>entities.push({type:'player',radius:COLLISION_RADIUS,...remote}));
    return entities;
  }

  function addWorldItem(item) {
    if(!item||item.type!=='item'||!Number.isFinite(item.x)||!Number.isFinite(item.y)) return false;
    item.collected=false;
    worldItems.add(item);
    return true;
  }

  function updateSkeletonStatsPosition(width,height) {
    const panel=document.getElementById('skeleton-stats');
    const skeleton=window.KTKEnemySkeleton.entity;
    refreshSkeletonCombatStats();
    if(skeleton.defeated) {
      panel.classList.remove('is-visible');
      return;
    }
    const screenX=skeleton.x-camera.x*width+width/2;
    const screenY=skeleton.y-camera.y*height+height/2-(skeleton.knockbackHeight||0);
    if(screenX < -50 || screenX > width+50 || screenY < -50 || screenY > height+50) {
      panel.classList.remove('is-visible');
      return;
    }
    const canvasRect=canvas.getBoundingClientRect();
    const x=Math.max(82,Math.min(window.innerWidth-82,canvasRect.left+screenX));
    const y=Math.max(92,canvasRect.top+screenY-48);
    panel.style.left=x+'px';
    panel.style.top=y+'px';
    panel.classList.add('is-visible');
  }

  function startPunch() {
    if(!gameStarted || !screens.game.classList.contains('active') || punch.cooldown>0) return;
    const selectedItem=inventory[selectedInventorySlot];
    const weapon=selectedItem&&selectedItem.itemType!=='ammo'?selectedItem:null;
    const staminaCost=weapon?.staminaCost>0?weapon.staminaCost:PUNCH_STAMINA_COST;
    if(!window.KTKPlayerStats.consumeStamina(staminaCost)) {
      toast(weapon?`Estamina insuficiente para usar ${weapon.displayName||'o item'}.`:'Estamina insuficiente para socar.');
      return;
    }
    punch.active=true;
    punch.elapsed=0;
    punch.cooldown=weapon?.attackInterval>0?weapon.attackInterval:PUNCH_COOLDOWN_SECONDS;
    punch.direction=player.direction;
    punch.hitApplied=false;
    punch.weaponAttack=Boolean(weapon);
    punch.range=weapon?.range>0?weapon.range:PUNCH_RANGE;
    punch.attackBonus=Number(weapon?.attackBonus)||0;
    punch.weaponItem=weapon;
  }

  function updatePunch(deltaSeconds) {
    punch.cooldown=Math.max(0,punch.cooldown-deltaSeconds);
    if(!punch.active) return;
    punch.elapsed+=deltaSeconds;
    if(!punch.hitApplied && punch.elapsed>=PUNCH_IMPACT_SECONDS) {
      punch.hitApplied=true;
      resolvePunchHit();
    }
    if(punch.elapsed>=PUNCH_ANIMATION_SECONDS) punch.active=false;
  }

  function resolvePunchHit() {
    applyCombatHit(player,window.KTKEnemySkeleton.entity,punch.direction);
  }

  function getEntityWorldPosition(entity) {
    if(entity===player) {
      return {
        x:camera.x*canvas.clientWidth+player.x,
        y:camera.y*canvas.clientHeight+player.y
      };
    }
    return {x:entity.x,y:entity.y};
  }

  function getEffectiveEntityStats(entity, attackBonusOverride) {
    if(entity===player) return window.KTKPlayerStats.getEffectiveCombatStats(attackBonusOverride);
    const condition=(
      entity.health/entity.maxHealth+
      entity.satiety/entity.maxSatiety+
      entity.hydration/entity.maxHydration+
      entity.stamina/entity.maxStamina
    )/4;
    const multiplier=Math.max(0,Math.min(2,condition*2));
    return {
      attack:Math.round(entity.attack*multiplier),
      defense:Math.round(entity.defense*multiplier),
      multiplier
    };
  }

  function refreshSkeletonCombatStats() {
    const skeleton=window.KTKEnemySkeleton.entity;
    const healthValue=document.getElementById('skeleton-health-value');
    const healthFill=document.getElementById('skeleton-health-fill');
    if(healthValue) healthValue.textContent=skeleton.health;
    if(healthFill) healthFill.style.width=`${Math.max(0,skeleton.health/skeleton.maxHealth*100)}%`;
    const combat=getEffectiveEntityStats(skeleton);
    const attackValue=document.getElementById('skeleton-attack-value');
    const defenseValue=document.getElementById('skeleton-defense-value');
    if(attackValue) attackValue.textContent=combat.attack;
    if(defenseValue) defenseValue.textContent=combat.defense;
  }

  function applyCombatHit(attacker,target,direction) {
    if(target===window.KTKEnemySkeleton.entity && target.defeated) return;
    const vector=[{x:0,y:-1},{x:-1,y:0},{x:0,y:1},{x:1,y:0}][direction];
    const attackerPosition=getEntityWorldPosition(attacker);
    const targetPosition=getEntityWorldPosition(target);
    const dx=targetPosition.x-attackerPosition.x;
    const dy=targetPosition.y-attackerPosition.y;
    const forward=dx*vector.x+dy*vector.y;
    const sideways=Math.abs(dx*vector.y-dy*vector.x);
    const range=(attacker===player?punch.range:PUNCH_RANGE)*TILE+(target.radius||COLLISION_RADIUS);
    if(forward<=0||forward>range||sideways>(target.radius||COLLISION_RADIUS)+14) return;

    const attackBonus=attacker===player?(punch.weaponAttack?punch.attackBonus:0):undefined;
    const attack=getEffectiveEntityStats(attacker,attackBonus).attack;
    const defense=getEffectiveEntityStats(target).defense;
    const damage=Math.max(1,attack-defense);
    if(attacker===player&&punch.weaponAttack&&punch.weaponItem&&punch.weaponItem.durabilityUnit!=='blocks') {
      punch.weaponItem.durability=Math.max(0,punch.weaponItem.durability-1);
      if(punch.weaponItem.durability===0) {
        const slot=inventory.indexOf(punch.weaponItem);
        if(slot>=0) inventory[slot]=null;
        toast(`${punch.weaponItem.displayName||'Item'} quebrou.`);
      }
      renderInventory();
    }
    if(target===player) {
      const health=window.KTKPlayerStats.stats.health;
      health.value=Math.max(health.min,health.value-damage);
      window.KTKPlayerStats.render();
    } else {
      target.attacking=false;
      target.attackElapsed=0;
      target.health=Math.max(0,target.health-damage);
      if(target.health===0) {
        target.defeated=true;
        toast('Esqueleto derrotado.');
      }
      refreshSkeletonCombatStats();
    }
    startKnockback(target,vector);
  }

  function startKnockback(target,vector) {
    target.knockback={x:vector.x,y:vector.y,progress:0};
  }

  function updateKnockbacks(deltaSeconds) {
    const skeleton=window.KTKEnemySkeleton.entity;
    [player,skeleton].forEach(target=>{
      const knockback=target.knockback;
      if(!knockback) return;
      const previous=knockback.progress;
      knockback.progress=Math.min(1,previous+deltaSeconds/KNOCKBACK_SECONDS);
      const distance=KNOCKBACK_DISTANCE*(knockback.progress-previous);
      if(target===player) {
        movePlayerWithCollisions(knockback.x*distance,knockback.y*distance);
      } else {
        target.x+=knockback.x*distance;
        target.y+=knockback.y*distance;
      }
      target.knockbackHeight=Math.sin(knockback.progress*Math.PI)*KNOCKBACK_HEIGHT;
      if(knockback.progress>=1) {
        target.knockback=null;
        target.knockbackHeight=0;
      }
    });
  }

  function directionToward(dx,dy) {
    if(Math.abs(dx)>Math.abs(dy)) return dx<0?1:3;
    return dy<0?0:2;
  }

  function updateEnemyCombat(deltaSeconds) {
    const enemy=window.KTKEnemySkeleton.entity;
    if(enemy.defeated) return;
    enemy.attackCooldown=Math.max(0,enemy.attackCooldown-deltaSeconds);
    if(!enemy.attacking) enemy.stamina=Math.min(enemy.maxStamina,enemy.stamina+deltaSeconds*4);
    if(enemy.attacking) {
      enemy.attackElapsed+=deltaSeconds;
      if(!enemy.attackHitApplied&&enemy.attackElapsed>=PUNCH_IMPACT_SECONDS) {
        enemy.attackHitApplied=true;
        applyCombatHit(enemy,player,enemy.direction);
      }
      if(enemy.attackElapsed>=PUNCH_ANIMATION_SECONDS) enemy.attacking=false;
      return;
    }
    const playerPosition=getEntityWorldPosition(player);
    const dx=playerPosition.x-enemy.x;
    const dy=playerPosition.y-enemy.y;
    const attackRange=PUNCH_RANGE*TILE+COLLISION_RADIUS;
    if(Math.hypot(dx,dy)>attackRange||enemy.attackCooldown>0||enemy.stamina<PUNCH_STAMINA_COST) return;
    enemy.direction=directionToward(dx,dy);
    enemy.stamina-=PUNCH_STAMINA_COST;
    enemy.attackCooldown=PUNCH_COOLDOWN_SECONDS;
    enemy.attacking=true;
    enemy.attackElapsed=0;
    enemy.attackHitApplied=false;
  }

  function describeEquipment(item) {
    const format=value=>Number(value).toLocaleString('pt-BR',{maximumFractionDigits:2});
    const details=[item.displayName||'Item',item.category].filter(Boolean);
    if(item.attackBonus>0) details.push(`Ataque +${format(item.attackBonus)}`);
    if(item.range>0) details.push(`Alcance ${format(item.range)}`);
    if(item.staminaCost>0) details.push(`Estamina ${format(item.staminaCost)}`);
    if(item.attackInterval>0) details.push(`Intervalo ${format(item.attackInterval)} s`);
    if(item.defenseBonus>0) details.push(`Defesa +${format(item.defenseBonus)} ao bloquear`);
    if(item.blockStaminaCost>0) details.push(`Estamina por bloqueio ${format(item.blockStaminaCost)}`);
    if(item.projectileSpeed>0) details.push(`Velocidade do projetil ${format(item.projectileSpeed)}`);
    if(item.manaCost>0) details.push(`Mana ${format(item.manaCost)}`);
    if(item.castTime>0) details.push(`Conjuracao ${format(item.castTime)} s`);
    if(item.ammoPerAttack>0) details.push(`Consome ${item.ammoPerAttack} por disparo`);
    if(item.quantity!=null) details.push(`Quantidade ${item.quantity}`);
    if(item.durability>0) details.push(`Durabilidade ${item.durability}/${item.maxDurability} ${item.durabilityUnit}`);
    return details.join(' | ');
  }

  function renderInventory() {
    document.querySelectorAll('.inventory-slot').forEach((slot,index)=>{
      const selected=index===selectedInventorySlot;
      slot.classList.toggle('is-selected',selected);
      slot.setAttribute('aria-pressed',String(selected));
      const canvas=slot.querySelector('canvas');
      const g=canvas.getContext('2d');
      g.clearRect(0,0,canvas.width,canvas.height);
      const item=inventory[index];
      if(!item) {
        slot.title='Espaço vazio';
        return;
      }
      slot.title=describeEquipment(item);
      if(item.iconCanvas) {
        g.imageSmoothingEnabled=false;
        g.drawImage(item.iconCanvas,0,0,64,64);
      } else if(item.image?.complete && item.image.naturalWidth) {
        g.imageSmoothingEnabled=false;
        g.drawImage(item.image,item.sourceX,item.sourceY,item.frameWidth,item.frameHeight,0,0,64,64);
      }
    });
    window.KTKPlayerStats.render();
  }

  function selectInventorySlot(index) {
    if(index<0||index>=inventory.length) return;
    selectedInventorySlot=index;
    renderInventory();
  }

  function collectNearbyItem() {
    const worldX=camera.x*canvas.clientWidth+player.x;
    const worldY=camera.y*canvas.clientHeight+player.y;
    let itemToCollect=null;
    let closestDistance=Infinity;
    worldItems.forEach(item=>{
      if(item.collected) return;
      const distance=Math.hypot(worldX-item.x,worldY-item.y);
      if(distance<closestDistance) {
        closestDistance=distance;
        itemToCollect=item;
      }
    });
    if(!itemToCollect) return;
    if(closestDistance>64) {
      toast(`Chegue mais perto de ${itemToCollect.displayName||'item'} para coletar.`);
      return;
    }
    const previousItem=inventory[selectedInventorySlot];
    if(previousItem&&previousItem!==itemToCollect) {
      dropItemAtPlayer(previousItem,(player.direction+2)%4);
    }
    inventory[selectedInventorySlot]=itemToCollect;
    itemToCollect.collected=true;
    renderInventory();
    [itemToCollect.image,itemToCollect.iconImage].filter(Boolean).forEach(image=>{
      if(!image.complete) image.addEventListener('load',renderInventory,{once:true});
    });
    toast(previousItem&&previousItem!==itemToCollect
      ? `${itemToCollect.displayName||'Item'} coletado; ${previousItem.displayName||'item anterior'} solto.`
      : `${itemToCollect.displayName||'Item'} coletado.`);
  }

  function dropItemAtPlayer(item,directionIndex=player.direction) {
    const directions=[{x:0,y:-1},{x:-1,y:0},{x:0,y:1},{x:1,y:0}];
    const direction=directions[directionIndex]||directions[2];
    item.x=camera.x*canvas.clientWidth+player.x+direction.x*48;
    item.y=camera.y*canvas.clientHeight+player.y+direction.y*48;
    item.collected=false;
    worldItems.add(item);
  }

  function drawWorldItem(g,item,x,y) {
    if(typeof item.draw==='function') {
      item.draw(g,x,y);
      return;
    }
    if(item.iconCanvas) {
      const size=item.iconSize||item.displaySize||38;
      g.save();
      g.imageSmoothingEnabled=false;
      g.drawImage(item.iconCanvas,x-size/2,y-size/2,size,size);
      g.restore();
      return;
    }
    if(!item.image?.complete||!item.image.naturalWidth) return;
    const width=item.displaySize||item.frameWidth||64;
    const height=item.displayHeight||item.frameHeight||64;
    g.save();
    g.imageSmoothingEnabled=false;
    g.drawImage(
      item.image,
      item.sourceX||0,item.sourceY||0,item.frameWidth||width,item.frameHeight||height,
      x-width/2,y-height/2,width,height
    );
    g.restore();
  }

  function interactWithSelectedItem() {
    const selectedItem=inventory[selectedInventorySlot];
    if(!selectedItem) {
      collectNearbyItem();
      return;
    }
    if(selectedItem.type!=='item'||!Number.isFinite(selectedItem.x)||!Number.isFinite(selectedItem.y)) {
      toast('Este item nao pode ser solto.');
      return;
    }
    dropItemAtPlayer(selectedItem);
    inventory[selectedInventorySlot]=null;
    renderInventory();
    toast(`${selectedItem.displayName||'Item'} solto.`);
  }
  function getSolidEntities() {
    return getWorldEntities().filter(entity=>entity.solid!==false && (entity.type==='enemy' || entity.type==='player'));
  }

  // Move por eixo, permitindo deslizar ao longo de inimigos e outros jogadores.
  function movePlayerWithCollisions(dx,dy) {
    const solids=getSolidEntities();
    const blocked=(x,y)=>solids.some(entity=>{
      const minDistance=COLLISION_RADIUS+(entity.radius||COLLISION_RADIUS);
      return Math.hypot(x-entity.x,y-entity.y)<minDistance;
    });
    if(!blocked(player.x+dx,player.y)) player.x+=dx;
    if(!blocked(player.x,player.y+dy)) player.y+=dy;
  }

  // Entrada para sincronização futura de posições vindas do servidor online.
  function setRemotePlayers(players) {
    remotePlayers.clear();
    (players||[]).forEach(remote=>{
      if(!remote || remote.id==null || !Number.isFinite(remote.x) || !Number.isFinite(remote.y)) return;
      remotePlayers.set(String(remote.id),{...remote,type:'player'});
    });
  }
  window.KTKWorldEntities={setRemotePlayers,entities:getWorldEntities,addItem:addWorldItem};
  function startGame() {
    if(!gameStarted) {
      gameStarted=true;
      player.x=0; player.y=0; player.direction=2;
      camera.x=0; camera.y=0; walkTime=0;
      toast('Você chegou ao mundo. Explore à vontade!');
    } else {
      toast('Aparência atualizada. Boa exploração!');
    }
    document.getElementById('enter-world').textContent='Entrar no mundo →';
    showScreen('game');
    if(!equipmentItemsArranged) {
      window.KTKEquipmentCatalog.arrangeFirstMap(canvas.clientWidth,canvas.clientHeight);
      equipmentItemsArranged=true;
    }
  }

  function toast(message) {
    const el=document.getElementById('toast');
    el.textContent=message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>el.classList.remove('show'),2600);
  }

  document.getElementById('create-start').addEventListener('click',()=>{
    document.getElementById('enter-world').textContent='Entrar no mundo →';
    showScreen('creator');
    updateCreator();
  });
  document.getElementById('back-welcome').addEventListener('click',()=>showScreen('welcome'));
  document.getElementById('enter-world').addEventListener('click',startGame);
  document.getElementById('edit-character').addEventListener('click',()=>{
    document.getElementById('enter-world').textContent='Voltar ao mundo →';
    showScreen('creator');
    updateCreator();
  });
  document.getElementById('reset-world').addEventListener('click',()=>{
    player.x=0; player.y=0; camera.x=0; camera.y=0;
    toast('Você voltou ao ponto inicial.');
  });

  document.querySelectorAll('[data-gender]').forEach(btn=>btn.addEventListener('click',()=>{
    character.gender=btn.dataset.gender;
    updateCreator();
  }));
  document.getElementById('hairstyle-select').addEventListener('change',event=>{
    character.hairstyle=event.target.value;
    updateCreator();
  });
  document.getElementById('beard-select').addEventListener('change',event=>{
    character.beard=event.target.value;
    updateCreator();
  });
  document.getElementById('mustache-select').addEventListener('change',event=>{
    character.mustache=event.target.value;
    updateCreator();
  });

  window.addEventListener('keydown',event=>{
    const key=event.key.toLowerCase();
    if(['arrowup','arrowdown','arrowleft','arrowright',' '].includes(key)) event.preventDefault();
    if(screens.game.classList.contains('active')) {
      keys.add(key);
      if(key==='e'&&!event.repeat) interactWithSelectedItem();
      if((key==='1'||key==='2')&&!event.repeat) selectInventorySlot(Number(key)-1);
    }
    if(key==='escape'&&gameStarted&&screens.game.classList.contains('active')) {
      document.getElementById('enter-world').textContent='Voltar ao mundo →';
      showScreen('creator');
      updateCreator();
    }
  },{passive:false});
  window.addEventListener('keyup',event=>keys.delete(event.key.toLowerCase()));
  canvas.addEventListener('mousedown',event=>{
    if(event.button===0) {
      leftMouseHeld=true;
      window.KTKPlayerStats.render();
      const selectedItem=inventory[selectedInventorySlot];
      if(selectedItem?.equipmentClass!=='shield') startPunch();
    }
  });
  window.addEventListener('mouseup',event=>{
    if(event.button===0&&leftMouseHeld) {
      leftMouseHeld=false;
      window.KTKPlayerStats.render();
    }
  });
  document.querySelectorAll('.inventory-slot:not(.is-locked)').forEach(slot=>{
    slot.tabIndex=0;
    slot.setAttribute('role','button');
    slot.addEventListener('click',()=>selectInventorySlot(Number(slot.dataset.slot)));
    slot.addEventListener('keydown',event=>{
      if(event.key==='Enter'||event.key===' ') {
        event.preventDefault();
        selectInventorySlot(Number(slot.dataset.slot));
      }
    });
  });
  window.addEventListener('blur',()=>{
    keys.clear();
    if(leftMouseHeld) {
      leftMouseHeld=false;
      window.KTKPlayerStats.render();
    }
  });

  window.addEventListener('resize',resize);
  updateCreator();
  renderInventory();
  resize();
  requestAnimationFrame(render);
})();
