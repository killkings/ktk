/* Renderização de personagens, sombras, sprites e prévia visual. */
'use strict';

  function drawLayeredCharacter(g, x, y, layers, scale, direction, frame, damaged=false, syncFrameColumns=0) {
    if (!layers || !layers.length) return;
    g.save();
    g.imageSmoothingEnabled = false;
    layers.forEach(layer => {
      if (!layer.image) return;
      if (!(layer.image.naturalWidth || layer.image.width)) return;
      const sprite=damaged?getDamageTintedSprite(layer.image):layer.image;
      const size=layer.frameSize||FRAME_SIZE;
      const displaySize=layer.displaySize||size;
      const columns=Math.max(1,Math.floor(sprite.width/size));
      const rows=Math.max(1,Math.floor(sprite.height/size));
      const sourceFrame=Number.isInteger(layer.staticFrame)
        ? layer.staticFrame
        : Number.isInteger(layer.reverseFrameCount)
          ? Math.max(0,layer.reverseFrameCount-1-frame)
          : frame;
      const bodyFrame=syncFrameColumns>0?sourceFrame%syncFrameColumns:sourceFrame;
      const layerFrame=layer.syncToBody&&syncFrameColumns>0
        ? layer.fallbackMotion&&syncFrameColumns<=IDLE_COLUMNS&&columns>syncFrameColumns
          ? Math.floor(columns/2)
          : Math.round(bodyFrame/syncFrameColumns*columns)
        : layer.fallbackMotion&&syncFrameColumns>0
        ? syncFrameColumns<=IDLE_COLUMNS&&columns>syncFrameColumns
          ? Math.floor(columns/2)
          : Math.round(bodyFrame/syncFrameColumns*columns)
        : sourceFrame;
      const left=x-(displaySize/2)*scale;
      const top=y-(displaySize/2)*scale;
      g.drawImage(
        sprite,
        (layerFrame%columns)*size,(direction%rows)*size,size,size,
        left,top,displaySize*scale,displaySize*scale
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
    const heading=[item.category,item.displayName||'Item'].filter(Boolean).join(': ');
    g.save();
    g.textAlign='center';
    g.textBaseline='middle';
    const maxWidth=Math.max(120,Math.min(360,canvas.clientWidth-16));
    const lines=[heading];
    let currentLine='';
    g.font='9px system-ui';
    getEquipmentAttributeDetails(item).forEach(detail=>{
      const candidate=currentLine?`${currentLine} · ${detail}`:detail;
      if(currentLine&&g.measureText(candidate).width>maxWidth-14) {
        lines.push(currentLine);
        currentLine=detail;
      } else currentLine=candidate;
    });
    if(currentLine) lines.push(currentLine);
    g.font='600 10px system-ui';
    const width=Math.min(maxWidth,Math.max(90,...lines.map(line=>g.measureText(line).width+14)));
    const lineHeight=13;
    const height=lines.length*lineHeight+8;
    const labelX=Math.max(width/2+6,Math.min(canvas.clientWidth-width/2-6,x));
    const labelY=Math.max(height/2+6,Math.min(canvas.clientHeight-height/2-6,y-(item.iconSize||item.displaySize||38)/2-8-height/2));
    g.fillStyle='rgba(13,22,15,.88)';
    g.fillRect(labelX-width/2,labelY-height/2,width,height);
    g.strokeStyle='rgba(223,235,196,.65)';
    g.lineWidth=1;
    g.strokeRect(labelX-width/2+.5,labelY-height/2+.5,width-1,height-1);
    lines.forEach((line,index)=>{
      g.font=index===0?'600 10px system-ui':'9px system-ui';
      g.fillStyle=index===0?'#f2f5e7':'#d8e4cc';
      g.fillText(line,labelX,labelY-height/2+lineHeight/2+4+index*lineHeight,width-10);
    });
    g.restore();
  }

  function isNearLocalPlayer(entity) {
    const playerWorldX=camera.x*canvas.clientWidth+player.x;
    const playerWorldY=camera.y*canvas.clientHeight+player.y;
    return Math.hypot(playerWorldX-entity.x,playerWorldY-entity.y)<=NEARBY_INFO_RADIUS;
  }

  function readEntityAttribute(source,...keys) {
    for(const key of keys) {
      let value=source?.[key];
      if(value&&typeof value==='object'&&'value' in value) value=value.value;
      const numeric=Number(value);
      if(value!==null&&value!==undefined&&Number.isFinite(numeric)) return numeric;
    }
    return null;
  }

  function drawNearbyEntityStats(g,entity,x,y) {
    if(!['enemy','player'].includes(entity.type)||entity.id==='skeleton-1'||!isNearLocalPlayer(entity)) return;
    const source=entity.combatStats||entity.attributes||entity.stats||entity;
    const rows=[];
    const name=entity.displayName||entity.playerName||entity.name;
    if(name) rows.push(String(name));
    const health=readEntityAttribute(source,'health','hp');
    const maxHealth=readEntityAttribute(source,'maxHealth','maxHp');
    if(health!==null) rows.push(`Vida ${Math.round(health)}${maxHealth!==null?`/${Math.round(maxHealth)}`:''}`);
    const attack=readEntityAttribute(source,'attack');
    if(attack!==null) rows.push(`Ataque ${Math.round(attack)}`);
    const defense=readEntityAttribute(source,'defense');
    if(defense!==null) rows.push(`Defesa ${Math.round(defense)}`);
    if(entity.isKing||entity.hasKingCrown) rows.push('Rei');
    if(!rows.length) return;

    g.save();
    g.font='bold 10px system-ui';
    g.textAlign='center';
    g.textBaseline='middle';
    const width=Math.max(72,...rows.map(row=>g.measureText(row).width+16));
    const height=rows.length*14+8;
    const left=x-width/2;
    const entityScale=entity.type==='player'?PLAYER_WORLD_SCALE:WORLD_SCALE;
    const top=y-(entity.knockbackHeight||0)-FRAME_SIZE*entityScale/2-height-7;
    g.fillStyle='rgba(12,24,18,.94)';
    g.strokeStyle='#d9e89d';
    g.lineWidth=1.5;
    g.fillRect(left,top,width,height);
    g.strokeRect(left,top,width,height);
    g.fillStyle='#e8efdc';
    rows.forEach((row,index)=>g.fillText(row,x,top+8+index*14));
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
    const mainHandItem=selectedItem?.equipmentClass==='shield'||selectedItem?.wearSlot?null:selectedItem;
    const reverseBodyFrames=weaponMode==='attack'&&Boolean(mainHandItem?.attackReverseBodyFrames);
    const layers=reverseBodyFrames
      ? baseLayers.map(layer=>({...layer,reverseFrameCount:mainHandItem.attackFrameCount||6}))
      : [...baseLayers];

    if(weaponMode!=='none'&&mainHandItem&&mainHandItem.itemType!=='ammo') {
      if(mainHandItem.id==='longsword-1') {
        const weaponLayers=weaponMode==='attack'?swordSlashLayers:swordLayers;
        layers.push(...weaponLayers);
      } else {
        const image=weaponMode==='attack'&&mainHandItem.attackImage?.naturalWidth
          ? mainHandItem.attackImage
          : mainHandItem.image;
        if(image?.naturalWidth) {
          const frameSize=weaponMode==='attack'
            ? (mainHandItem.attackFrameSize||mainHandItem.heldFrameSize||FRAME_SIZE)
            : (mainHandItem.heldFrameSize||FRAME_SIZE);
          const displaySize=weaponMode==='attack'
            ? (mainHandItem.attackDisplaySize||frameSize)
            : (mainHandItem.heldDisplaySize||FRAME_SIZE);
          const staticFrame=weaponMode==='held'&&Number.isInteger(mainHandItem.heldStaticFrame)
            ? mainHandItem.heldStaticFrame
            : undefined;
          const backgroundImage=weaponMode==='attack'
            ? (mainHandItem.attackBackgroundImage||mainHandItem.heldBackgroundImage)
            : mainHandItem.heldBackgroundImage;
          const z=Number(weaponMode==='attack'
            ? (mainHandItem.attackEquipmentZ??150)
            : (mainHandItem.equipmentZ??150));
          const backgroundZ=weaponMode==='attack'?Number(mainHandItem.attackBackgroundZ??-1):-1;
          const backgroundStaticFrame=weaponMode==='held'&&Number.isInteger(mainHandItem.heldBackgroundStaticFrame)
            ? mainHandItem.heldBackgroundStaticFrame
            : staticFrame;
          if(backgroundImage?.naturalWidth) layers.push({image:backgroundImage,frameSize,displaySize,z:backgroundZ,staticFrame:backgroundStaticFrame});
          layers.push({image,frameSize,displaySize,z,staticFrame});
        }
      }
    }

    const shield=getBlockingShield();
    if(shield&&shield!==mainHandItem&&!mainHandItem?.twoHanded&&shield.image?.naturalWidth) {
      const frameSize=shield.heldFrameSize||FRAME_SIZE;
      const staticFrame=Number.isInteger(shield.heldStaticFrame)?shield.heldStaticFrame:undefined;
      const z=Number(shield.equipmentZ??155);
      if(shield.heldBackgroundImage?.naturalWidth) {
        layers.push({image:shield.heldBackgroundImage,frameSize,z:-2,staticFrame});
      }
      layers.push({image:shield.image,frameSize,z,staticFrame});
    }

    return layers.sort((a,b)=>(a.z??a.definition?.z??0)-(b.z??b.definition?.z??0));
  }

  function getRemotePlayerAttackLayers(baseLayers,attack) {
    const item=attack.weaponId==='longsword-1'
      ? window.KTKWorldSword?.entity
      : equipmentCatalog?.items.find(candidate=>candidate.id===attack.weaponId);
    const reverseBodyFrames=Boolean(item?.attackReverseBodyFrames);
    const layers=reverseBodyFrames
      ? baseLayers.map(layer=>({...layer,reverseFrameCount:item.attackFrameCount||attack.frameCount||6}))
      : [...baseLayers];
    if(item&&item.itemType!=='ammo'&&item.equipmentClass!=='shield'&&!item.wearSlot) {
      if(item.id==='longsword-1') {
        layers.push(...swordSlashLayers);
      } else {
        const image=item.attackImage?.naturalWidth?item.attackImage:item.image;
        if(image?.naturalWidth) {
          const frameSize=item.attackFrameSize||item.heldFrameSize||FRAME_SIZE;
          const displaySize=item.attackDisplaySize||frameSize;
          const backgroundImage=item.attackBackgroundImage||null;
          if(backgroundImage?.naturalWidth) {
            layers.push({image:backgroundImage,frameSize,displaySize,z:Number(item.attackBackgroundZ??-1)});
          }
          layers.push({image,frameSize,displaySize,z:Number(item.attackEquipmentZ??150)});
        }
      }
    }
    return layers.sort((a,b)=>(a.z??a.definition?.z??0)-(b.z??b.definition?.z??0));
  }


