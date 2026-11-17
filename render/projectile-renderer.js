/* Renderização visual dos projéteis. */
'use strict';

  function drawBoomerangProjectile(g,x,y) {
    const item=boomerangProjectile.item;
    if(!boomerangProjectile.active||!item?.image?.naturalWidth) return;
    const frameSize=item.heldFrameSize||192;
    const columns=Math.max(1,Math.floor(item.image.naturalWidth/frameSize));
    const frame=Math.floor(boomerangProjectile.elapsed*18)%Math.min(columns,item.attackFrameCount||6);
    drawLayeredCharacter(g,x,y,[{
      image:item.image,
      frameSize,
      displaySize:BOOMERANG_PROJECTILE_DISPLAY_SIZE,
      staticFrame:frame
    }],WORLD_SCALE,boomerangProjectile.direction,frame);
  }

  function getArrowProjectileBounds(direction) {
    const image=arrowSpriteItem?.image;
    if(!image?.naturalWidth) return null;
    const row=((direction%4)+4)%4;
    if(arrowProjectileBoundsCache.has(row)) return arrowProjectileBoundsCache.get(row);

    let bounds={sourceX:0,sourceY:row*FRAME_SIZE,width:FRAME_SIZE,height:FRAME_SIZE};
    try {
      const cell=document.createElement('canvas');
      cell.width=FRAME_SIZE;
      cell.height=FRAME_SIZE;
      const cellContext=cell.getContext('2d',{willReadFrequently:true});
      cellContext.drawImage(image,0,row*FRAME_SIZE,FRAME_SIZE,FRAME_SIZE,0,0,FRAME_SIZE,FRAME_SIZE);
      const pixels=cellContext.getImageData(0,0,FRAME_SIZE,FRAME_SIZE).data;
      let minX=FRAME_SIZE,minY=FRAME_SIZE,maxX=-1,maxY=-1;
      for(let y=0;y<FRAME_SIZE;y++) for(let x=0;x<FRAME_SIZE;x++) {
        if(pixels[(y*FRAME_SIZE+x)*4+3]>16) {
          minX=Math.min(minX,x); minY=Math.min(minY,y);
          maxX=Math.max(maxX,x); maxY=Math.max(maxY,y);
        }
      }
      if(maxX>=minX&&maxY>=minY) {
        bounds={sourceX:minX,sourceY:row*FRAME_SIZE+minY,width:maxX-minX+1,height:maxY-minY+1};
      }
    } catch(error) {
      console.warn('Não foi possível recortar o sprite da flecha:',error);
    }
    arrowProjectileBoundsCache.set(row,bounds);
    return bounds;
  }

  function drawArrowProjectile(g,x,y) {
    const image=arrowSpriteItem?.image;
    if(!arrowProjectile.active||!image?.naturalWidth) return;
    const bounds=getArrowProjectileBounds(arrowProjectile.direction);
    if(!bounds) return;
    const width=bounds.width*WORLD_SCALE;
    const height=bounds.height*WORLD_SCALE;
    const directionAngles=[-Math.PI/2,Math.PI,Math.PI/2,0];
    g.save();
    g.imageSmoothingEnabled=false;
    g.translate(x,y);
    g.rotate(arrowProjectile.angle-directionAngles[arrowProjectile.direction]);
    g.drawImage(image,bounds.sourceX,bounds.sourceY,bounds.width,bounds.height,-width/2,-height/2,width,height);
    g.restore();
  }

  function drawStoneProjectile(g,x,y) {
    if(!stoneProjectile.active) return;
    const size=STONE_PROJECTILE_DISPLAY_SIZE*WORLD_SCALE;
    g.save();
    g.imageSmoothingEnabled=false;
    g.translate(x,y);
    g.rotate(stoneProjectile.elapsed*10);
    g.drawImage(stoneProjectileSprite,-size/2,-size/2,size,size);
    g.restore();
  }

  function drawMagicProjectile(g,x,y) {
    if(!magicProjectile.active) return;
    const pulse=1+Math.sin(magicProjectile.elapsed*18)*0.16;
    const radius=7*pulse;
    g.save();
    g.globalCompositeOperation='lighter';
    g.shadowColor='rgba(255,255,255,.95)';
    g.shadowBlur=14;
    g.fillStyle='rgba(238,246,255,.34)';
    g.beginPath();
    g.arc(x,y,radius+5,0,Math.PI*2);
    g.fill();
    g.shadowBlur=6;
    g.fillStyle='#e9f1ff';
    g.beginPath();
    g.arc(x,y,radius,0,Math.PI*2);
    g.fill();
    g.fillStyle='#ffffff';
    g.beginPath();
    g.arc(x-magicProjectile.vectorX*1.5,y-magicProjectile.vectorY*1.5,radius*.48,0,Math.PI*2);
    g.fill();
    for(let i=1;i<=3;i++) {
      const trailX=x-magicProjectile.vectorX*i*9;
      const trailY=y-magicProjectile.vectorY*i*9;
      const sparkleSize=Math.max(1,4-i);
      g.globalAlpha=(4-i)/6;
      g.fillRect(trailX-sparkleSize/2,trailY-sparkleSize/2,sparkleSize,sparkleSize);
    }
    g.restore();
  }

  function drawRemoteProjectile(g,x,y,projectile) {
    const item=equipmentCatalog?.items.find(candidate=>candidate.id===projectile.weaponId);
    if(projectile.projectileType==='arrow') {
      const image=arrowSpriteItem?.image;
      const bounds=getArrowProjectileBounds(projectile.direction);
      if(!image?.naturalWidth||!bounds) return;
      const width=bounds.width*WORLD_SCALE,height=bounds.height*WORLD_SCALE;
      const directionAngles=[-Math.PI/2,Math.PI,Math.PI/2,0];
      g.save();
      g.imageSmoothingEnabled=false;
      g.translate(x,y);
      g.rotate(Math.atan2(projectile.vectorY,projectile.vectorX)-directionAngles[projectile.direction]);
      g.drawImage(image,bounds.sourceX,bounds.sourceY,bounds.width,bounds.height,-width/2,-height/2,width,height);
      g.restore();
      return;
    }
    if(projectile.projectileType==='stone') {
      const size=STONE_PROJECTILE_DISPLAY_SIZE*WORLD_SCALE;
      g.save();
      g.imageSmoothingEnabled=false;
      g.translate(x,y);
      g.rotate(projectile.elapsed*10);
      g.drawImage(stoneProjectileSprite,-size/2,-size/2,size,size);
      g.restore();
      return;
    }
    if(projectile.projectileType==='magic') {
      const pulse=1+Math.sin(projectile.elapsed*18)*0.16;
      const radius=7*pulse;
      g.save();
      g.globalCompositeOperation='lighter';
      g.shadowColor='rgba(255,255,255,.95)';
      g.shadowBlur=14;
      g.fillStyle='rgba(238,246,255,.34)';
      g.beginPath(); g.arc(x,y,radius+5,0,Math.PI*2); g.fill();
      g.shadowBlur=6;
      g.fillStyle='#e9f1ff';
      g.beginPath(); g.arc(x,y,radius,0,Math.PI*2); g.fill();
      g.fillStyle='#ffffff';
      g.beginPath(); g.arc(x-projectile.vectorX*1.5,y-projectile.vectorY*1.5,radius*.48,0,Math.PI*2); g.fill();
      for(let i=1;i<=3;i++) {
        const trailX=x-projectile.vectorX*i*9,trailY=y-projectile.vectorY*i*9;
        const sparkleSize=Math.max(1,4-i);
        g.globalAlpha=(4-i)/6;
        g.fillRect(trailX-sparkleSize/2,trailY-sparkleSize/2,sparkleSize,sparkleSize);
      }
      g.restore();
      return;
    }
    if(projectile.projectileType==='boomerang'&&item?.image?.naturalWidth) {
      const frameSize=item.heldFrameSize||192;
      const columns=Math.max(1,Math.floor(item.image.naturalWidth/frameSize));
      const frame=Math.floor(projectile.elapsed*18)%Math.min(columns,item.attackFrameCount||6);
      drawLayeredCharacter(g,x,y,[{
        image:item.image,frameSize,displaySize:BOOMERANG_PROJECTILE_DISPLAY_SIZE,staticFrame:frame
      }],WORLD_SCALE,projectile.direction,frame);
    }
  }
