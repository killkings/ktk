/* Recolorização de pele, rosto, olhos, cabelo e roupas LPC. */
(function(){
  'use strict';
  const hairSourcePalettes=window.KTKHairSourcePalettes||[];
  const hairPalettes=window.KTKHairPalettes||{};
  const skinSource=window.skinSource||[];
  const skinPalettes=window.skinPalettes||{};
  const eyeSource=window.eyeSource||[];
  const eyePalettes=window.eyePalettes||{};
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
  function colorize(imageCanvas,mode,paletteKey){
    if(mode==='skin') return recolorPalette(imageCanvas,skinSource,skinPalettes[paletteKey]||skinPalettes.brown);
    if(mode==='face'){
      const [skinKey,eyeKey]=String(paletteKey||'brown:brown').split(':');
      return recolorFace(imageCanvas,skinPalettes[skinKey]||skinPalettes.brown,eyePalettes[eyeKey]||eyePalettes.brown);
    }
    if(mode==='hair') return recolorHair(imageCanvas,paletteKey);
    if(mode==='black') return recolorBlack(imageCanvas);
    if(mode==='tint') return recolorByLuminance(imageCanvas,tintPaletteFromColor(paletteKey));
    return imageCanvas;
  }
  window.KTKLPCColorizer=Object.freeze({colorize});
})();
