/* Montagem das camadas e conjuntos de animação do personagem. */
'use strict';

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
      window.KTKLPCAssetLoader.loadLayer(def.path,def.mode,def.palette).then(result=>({
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
      window.KTKLPCAssetLoader.loadLayer(def.path,null,null).then(result => ({...result,definition:def}))
      )),
      Promise.all(swordSlashDefinitions.map(def =>
      window.KTKLPCAssetLoader.loadLayer(def.path,null,null).then(result => ({...result,definition:def}))
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
