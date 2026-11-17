/* Carregamento, fallback de animações e cache compartilhado dos sprites LPC. */
(function(){
  'use strict';
  const SPRITES_ROOT=window.KTKLPC_CONFIG?.spritesRoot;
  if(!SPRITES_ROOT) throw new Error('A configuração central do LPC não foi carregada.');
  const imageCache=new Map();
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
              finalImage=window.KTKLPCColorizer.colorize(original,recolorMode,paletteKey);
            } catch(error) {
              window.fileColorFallback=true;
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
        img.src=SPRITES_ROOT+actualPath;
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
  window.KTKLPCAssetLoader=Object.freeze({
    loadLayer,
    clearCache(){imageCache.clear();},
    get cacheSize(){return imageCache.size;}
  });
})();
