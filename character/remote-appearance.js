/* Contrato único de aparência local/remota e carregamento das camadas remotas LPC. */
(function () {
  "use strict";

  function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function normalize(source) {
    const value=isRecord(source)?source:{};
    return {
      character:isRecord(value.character)?value.character:{},
      wearables:isRecord(value.wearables)?value.wearables:{}
    };
  }

  function hasEntries(value) {
    return isRecord(value) && Object.keys(value).length>0;
  }

  function merge(current,incoming,options={}) {
    const previous=normalize(current);
    const next=normalize(incoming);
    let character=previous.character;
    if(hasEntries(next.character)) {
      character=options.fillCharacter && hasEntries(previous.character)
        ? previous.character
        : {...previous.character,...next.character};
    }
    let wearables=previous.wearables;
    if(options.authoritativeWearables) {
      wearables=next.wearables;
    } else if(hasEntries(next.wearables)) {
      wearables={...previous.wearables,...next.wearables};
    }
    return {character,wearables};
  }

  function signature(source) {
    const value=normalize(source);
    return JSON.stringify({character:value.character,wearables:value.wearables});
  }

  window.KTKRemoteAppearance=Object.freeze({normalize,merge,signature});

  function scheduleRemoteAppearanceRetry(remote,signatureValue) {
    if(remote.appearanceRetryTimer) clearTimeout(remote.appearanceRetryTimer);
    const attempt=Number(remote.appearanceRetryCount)||0;
    const delays=[1000,2500,5000,10000,20000,30000];
    const delay=delays[Math.min(attempt,delays.length-1)];
    remote.appearanceRetryCount=attempt+1;
    remote.appearanceRetryAt=Date.now()+delay;
    remote.appearanceRetryTimer=setTimeout(()=>{
      remote.appearanceRetryTimer=null;
      if(remotePlayers.get(String(remote.id))!==remote) return;
      if(remote.appearanceSignature!==signatureValue) return;
      void window.loadRemoteCharacterLayers(remote);
    },delay);
  }

  window.loadRemoteCharacterLayers=async function loadRemoteCharacterLayers(remote) {
    const appearance=window.KTKRemoteAppearance.normalize(remote);
    remote.character=appearance.character;
    remote.wearables=appearance.wearables;
    const characterData=appearance.character;
    const wearables=appearance.wearables;
    const signatureValue=window.KTKRemoteAppearance.signature(appearance);

    if(remote.appearanceSignature!==signatureValue) {
      if(remote.appearanceRetryTimer) clearTimeout(remote.appearanceRetryTimer);
      remote.appearanceRetryTimer=null;
      remote.appearanceSignature=signatureValue;
      remote.appearanceLoadedSignature='';
      remote.layersReady=false;
      remote.appearanceRetryCount=0;
      remote.appearanceRetryAt=0;
    }
    if(remote.appearanceLoading && remote.appearanceLoadingSignature===signatureValue) {
      return remote.appearanceLoading;
    }
    if(remote.layersReady && remote.appearanceLoadedSignature===signatureValue) return;
    if(Date.now()<(Number(remote.appearanceRetryAt)||0)) return;

    const definitions=buildLayerDefinitions(characterData,wearables);
    const loadSet=defs=>Promise.all(defs.map(def=>window.KTKLPCAssetLoader.loadLayer(def.path,def.mode,def.palette).then(result=>({
      ...result,definition:def,fallbackMotion:result.path!==def.path
    }))));
    const loadMotion=motion=>loadSet(definitions.map(def=>({
      ...def,path:def.path.replace(/\/walk\.png$/,'/'+motion+'.png')
    })));

    const task=(async()=>{
      const [walk,idle,punch,slash,thrust,shoot]=await Promise.all([
        loadSet(definitions),
        loadMotion('idle'),
        loadMotion('halfslash'),
        loadMotion('slash'),
        loadMotion('thrust'),
        loadMotion('shoot')
      ]);
      if(remote.appearanceSignature!==signatureValue) return;

      const usable=layers=>layers.filter(layer=>layer.image&&!layer.missing);
      remote.walkLayers=usable(walk);
      remote.idleLayers=usable(idle);
      remote.attackLayers={
        punch:usable(punch),
        slash:usable(slash),
        thrust:usable(thrust),
        shoot:usable(shoot)
      };
      // A missing idle sheet must not make a successfully loaded walk sprite invisible.
      if(!remote.idleLayers.length) remote.idleLayers=remote.walkLayers;
      if(!remote.walkLayers.length) remote.walkLayers=remote.idleLayers;
      remote.layers=remote.idleLayers;

      const failed=[...walk,...idle,...punch,...slash,...thrust,...shoot]
        .filter(layer=>layer.missing||!layer.image);
      remote.layersReady=failed.length===0;
      remote.appearanceLoadedSignature=signatureValue;

      if(failed.length) {
        scheduleRemoteAppearanceRetry(remote,signatureValue);
        console.warn('KTK remote appearance incomplete; retry scheduled:',remote.id,failed.map(layer=>layer.definition?.path||layer.path));
      } else {
        remote.appearanceRetryCount=0;
        remote.appearanceRetryAt=0;
        if(remote.appearanceRetryTimer) clearTimeout(remote.appearanceRetryTimer);
        remote.appearanceRetryTimer=null;
      }
    })();

    remote.appearanceLoadingSignature=signatureValue;
    remote.appearanceLoading=task;
    try {
      await task;
    } catch(error) {
      if(remote.appearanceSignature===signatureValue) scheduleRemoteAppearanceRetry(remote,signatureValue);
      console.warn('KTK remote appearance load failed:',remote.id,error);
    } finally {
      if(remote.appearanceLoading===task) {
        remote.appearanceLoading=null;
        remote.appearanceLoadingSignature='';
      }
    }
  };
})();
