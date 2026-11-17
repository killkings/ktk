/* Carregamento LPC, recolorização e montagem das camadas de aparência. */
'use strict';

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

var  hairColorSources=new Map();
  hairSourcePalettes.forEach(ramp=>ramp.colors.forEach((hex,index)=>{
    const key=parseInt(hex.slice(1),16);
    if(!hairColorSources.has(key)) hairColorSources.set(key,[]);
    hairColorSources.get(key).push({id:ramp.id,index});
  }));

  function recolorHair(imageCanvas,paletteKey) {
    if (!hairSourcePalettes.length) return imageCanvas;
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
    if (!source || !target) return imageCanvas;
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

  function tintPaletteFromColor(color) {
    const base=hexToRgb(color);
    return [0.32,0.45,0.60,0.76,0.92,1.08].map(factor=>
      `#${base.map(channel=>Math.max(0,Math.min(255,Math.round(channel*factor))).toString(16).padStart(2,'0')).join('')}`
    );
  }

  function loadLayer(path, recolorMode, paletteKey) {
    const cacheKey=path+'|'+(recolorMode||'none')+'|'+(paletteKey||'');
    if(imageCache.has(cacheKey)) return imageCache.get(cacheKey);

    const promise=new Promise(resolve=>{
      const requestedMotion=path.match(/\/(walk|run|idle|thrust|shoot|halfslash|slash)\.png$/)?.[1];
      const fallbackMotions=requestedMotion==='halfslash'
        ? ['slash','walk']
        : (requestedMotion&&requestedMotion!=='walk' ? ['walk'] : []);
      const sources=[path,...fallbackMotions.map(motion=>
        path.replace(/\/(?:run|idle|thrust|shoot|halfslash|slash)\.png$/,'/'+motion+'.png')
      )];
      let sourceIndex=0;
      let retryCount=0;
      let settled=false;

      const finish=result=>{
        if(settled) return;
        settled=true;
        resolve(result);
      };

      const handleSourceFailure=()=>{
        if(retryCount<1) {
          retryCount++;
          setTimeout(loadCurrentSource,350);
          return;
        }
        retryCount=0;
        sourceIndex++;
        if(sourceIndex<sources.length) {
          loadCurrentSource();
          return;
        }
        finish({image:null,path,missing:true});
      };

      const loadCurrentSource=()=>{
        const actualPath=sources[sourceIndex];
        const img=new Image();
        img.crossOrigin='anonymous';
        img.onload=()=>{
          try {
            const original=document.createElement('canvas');
            original.width=img.naturalWidth;
            original.height=img.naturalHeight;
            const g=original.getContext('2d',{willReadFrequently:true});
            if(!g||!original.width||!original.height) throw new Error('Sprite sem dimensões válidas.');
            g.drawImage(img,0,0);
            let finalImage=original;
            try {
              if(recolorMode==='skin') finalImage=recolorPalette(original,skinSource,skinPalettes[paletteKey]||skinPalettes.brown);
              else if(recolorMode==='face') {
                const [skinKey,eyeKey]=String(paletteKey||'brown:brown').split(':');
                finalImage=recolorFace(original,skinPalettes[skinKey]||skinPalettes.brown,eyePalettes[eyeKey]||eyePalettes.brown);
              } else if(recolorMode==='hair') finalImage=recolorHair(original,paletteKey);
              else if(recolorMode==='black') finalImage=recolorBlack(original);
              else if(recolorMode==='tint') finalImage=recolorByLuminance(original,tintPaletteFromColor(paletteKey));
            } catch(error) {
              fileColorFallback=true;
              console.warn('Personalização de cores indisponível nesta origem; usando os sprites originais.',error);
              finalImage=original;
            }
            finish({image:finalImage,path:actualPath,missing:false});
          } catch(error) {
            console.warn('KTK sprite decode:',actualPath,error);
            handleSourceFailure();
          }
        };
        img.onerror=handleSourceFailure;
        img.src=LPC_ROOT+actualPath;
      };

      loadCurrentSource();
    });

    imageCache.set(cacheKey,promise);
    // Keep successful images cached, but never poison the cache with failures.
    void promise.then(result=>{
      if(result?.missing && imageCache.get(cacheKey)===promise) imageCache.delete(cacheKey);
    });
    return promise;
  }

  function buildLayerDefinitions(characterData=character, wearables=equippedWearables) {
    const normalizedAppearance=window.KTKRemoteAppearance?.normalize({character:characterData,wearables});
    if(normalizedAppearance) {
      characterData=normalizedAppearance.character;
      wearables=normalizedAppearance.wearables;
    }
    const gender=characterData.gender || 'male';
    const pantsGender=gender==='female'?'thin':'male';
    const shoeGender=gender==='female'?'thin':'male';
    const armGender=gender==='female'?'thin':'male';
    const layers=[
      {z:0,path:'body/bodies/'+gender+'/walk.png',mode:'skin',palette:characterData.skin||'brown',name:'corpo'},
      {z:100,path:'head/heads/human/'+gender+'/walk.png',mode:'skin',palette:characterData.skin||'brown',name:'cabeca'},
      {z:105,path:'head/faces/'+gender+'/neutral/walk.png',mode:'face',palette:(characterData.skin||'brown')+':'+(characterData.eyes||'brown'),name:'rosto'}
    ];
    wearableSlotOrder.forEach(slot=>{
      const item=wearables[slot];
      if(!item||(item.wearCategory==='armor'&&item.durability<=0)) return;
      (item.appearanceLayers||[]).forEach(layer=>{
        const path=String(layer.path||'')
          .replaceAll('{gender}',gender)
          .replaceAll('{lowerBodyGender}',pantsGender)
          .replaceAll('{shoeGender}',shoeGender)
          .replaceAll('{armGender}',armGender);
        if(path) layers.push({
          z:Number(layer.z)||0,
          path,
          mode:layer.mode||null,
          palette:layer.palette||null,
          name:item.displayName||slot,
          syncToBody:true,
          // Plate greaves have no halfslash sheet. Their slash sheet uses a
          // different leg pose, so use the matching trousers pose for punches.
          punchFallbackPath:slot==='legs'&&path.startsWith('legs/armour/plate/')
            ? path.replace('legs/armour/plate/','legs/pants2/')
            : null
        });
      });
    });
    const beard=(window.KTKBeardStyles || []).find(item=>item.id===(characterData.beard||'none'));
    (beard?.layers[gender] || []).forEach(layer=>layers.push({
      z:layer.z,path:layer.path,mode:'hair',palette:characterData.hair||'dark_brown',name:'barba'
    }));
    const mustache=(window.KTKMustacheStyles || []).find(item=>item.id===(characterData.mustache||'none'));
    (mustache?.layers[gender] || []).forEach(layer=>layers.push({
      z:layer.z,path:layer.path,mode:'hair',palette:characterData.hair||'dark_brown',name:'bigode'
    }));
    const hairstyle=(window.KTKHairStyles || []).find(item=>item.id===(characterData.hairstyle||'hair_pixie'));
    (hairstyle?.layers[gender] || []).forEach(hair=>layers.push({
      z:hair.z,path:hair.path,mode:'hair',palette:characterData.hair||'dark_brown',name:'cabelo'
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
    const punchDefinitions = definitions.map(def=>{
      const sourcePath=def.punchFallbackPath||def.path;
      return {...def,path:sourcePath.replace(/\/walk\.png$/,'/halfslash.png')};
    });
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
    const loadAnimationSet=animationDefinitions=>Promise.all(animationDefinitions.map(def=>
      loadLayer(def.path,def.mode,def.palette).then(result=>({
        ...result,
        definition:def,
        fallbackMotion:result.path!==def.path
      }))
    ));
    const [loaded,loadedRun,loadedIdle,loadedPunch,loadedSlash,loadedThrust,loadedShoot,loadedSword,loadedSwordSlash] = await Promise.all([
      loadAnimationSet(definitions),
      loadAnimationSet(runDefinitions),
      loadAnimationSet(idleDefinitions),
      loadAnimationSet(punchDefinitions),
      loadAnimationSet(slashDefinitions),
      loadAnimationSet(thrustDefinitions),
      loadAnimationSet(shootDefinitions),
      Promise.all(swordDefinitions.map(def =>
      loadLayer(def.path,null,null).then(result => ({...result,definition:def}))
      )),
      Promise.all(swordSlashDefinitions.map(def =>
      loadLayer(def.path,null,null).then(result => ({...result,definition:def}))
      ))
    ]);
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
