/* Estado compartilhado do cliente e configuração inicial dos subsistemas. */
'use strict';

var  canvas = document.getElementById('world');
var  ctx = canvas.getContext('2d');
var  preview = document.getElementById('preview');
var  pctx = preview.getContext('2d');
var  screens = {
    welcome: document.getElementById('welcome'),
    death: document.getElementById('death'),
    creator: document.getElementById('creator'),
    game: document.getElementById('game-ui')
  };

  // Os PNGs são carregados da pasta que fica ao lado deste arquivo HTML.
var  LPC_ROOT = 'https://raw.githubusercontent.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/04140673ec02906f8233523639733c83690df750/spritesheets/';
var  FRAME_SIZE = 64;
var  WALK_COLUMNS = 9;
var  WALK_ROWS = 4;
var  IDLE_COLUMNS = 2;
var  WORLD_SCALE = 1.28;
var  PREVIEW_SCALE = 3.5;
var  PUNCH_ANIMATION_SECONDS = 0.42;
var  PUNCH_IMPACT_SECONDS = 0.20;
var  PUNCH_COOLDOWN_SECONDS = 0.5;
var  PUNCH_RANGE = 0.8;
var  PUNCH_STAMINA_COST = 3;
var  KNOCKBACK_SECONDS = 0.24;
var  KNOCKBACK_DISTANCE = 28;
var  KNOCKBACK_HEIGHT = 12;
var  BOOMERANG_PROJECTILE_RADIUS = 12;
var  BOOMERANG_PROJECTILE_DISPLAY_SIZE = 128;
var  ARROW_PROJECTILE_RADIUS = 6;
var  RANGED_PROJECTILE_IMPACT_SECONDS = 0.14;
var  STONE_PROJECTILE_RADIUS = 8;
var  STONE_PROJECTILE_DISPLAY_SIZE = 14;
var  MAGIC_PROJECTILE_RADIUS = 12;

var  skinPalettes = {
    light:  ['#271920','#99423c','#cc8665','#E4A47C','#F9D5BA','#FAECE7'],
    amber:  ['#281716','#9E3E37','#D28144','#EA9F54','#FDD082','#FBE7A4'],
    olive:  ['#271920','#442725','#7F4C31','#AE6B3F','#D38B59','#E4A47C'],
    taupe:  ['#271920','#503734','#785946','#936849','#BA8454','#C7935F'],
    bronze: ['#1A1213','#442725','#644133','#7F4C31','#AE6B3F','#D38B59'],
    brown:  ['#120E10','#412B29','#5F4539','#76513A','#9C663E','#B8773F'],
    black:  ['#000000','#1A1213','#2E1F1C','#442725','#603429','#7F4C31']
  };
var  skinSource = ['#271920','#99423c','#cc8665','#E4A47C','#F9D5BA','#FAECE7'];
var  eyeSource = ['#5686AE','#57CEE4'];
var  eyePalettes = {
    brown:['#75452A','#B8793F'], blue:['#5686AE','#57CEE4'],
    green:['#39734D','#72B65C'], gray:['#71818B','#B8C2C7'],
    amber:['#A45B1E','#E8A833'], purple:['#7453A2','#B38BDA']
  };
var  hairPalettes = window.KTKHairPalettes || {};
var  hairSourcePalettes = window.KTKHairSourcePalettes || [];
var  palettes = {
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
  palettes.hair.forEach(item=>{ item.color=hairPalettes[item.id]?.[3] || item.color; });

var  character = {
    gender:'male', skin:'brown', eyes:'brown', hairstyle:'hair_pixie',
    hair:'dark_brown', beard:'none', mustache:'none'
  };
var  remoteLayerCache = new Map();

var  gameStarted = false;
var  playerDead = false;
var  newCharacterRequired = false;
var  lastTime = 0;
var  walkTime = 0;
var  idleTime = 0;
var  toastTimer = 0;
var  dpr = 1;
var  layerRequestId = 0;
var  currentLayers = [];
var  runLayers = [];
var  idleLayers = [];
var  thrustLayers = [];
var  shootLayers = [];
var  swordLayers = [];
var  swordSlashLayers = [];
var  punchLayers = [];
var  slashLayers = [];
var  previewLayers = [];
var  assetErrors = [];
var  playerMoving = false;
var  playerRunning = false;
  // Vetor bruto do teclado; a posição oficial é calculada pelo servidor.
var  playerInputX = 0;
var  playerInputY = 0;
var  punch = {active:false,elapsed:0,cooldown:0,direction:2,hitApplied:false,weaponAttack:false,weaponItem:null,range:PUNCH_RANGE,attackBonus:0,damageMultiplier:1};
var  boomerangProjectile = {type:'boomerang-projectile',active:false,item:null,x:0,y:0,startX:0,startY:0,direction:2,vectorX:0,vectorY:0,elapsed:0,distance:0,maxDistance:0,speed:0,phase:'outbound',hitApplied:false};
var  arrowProjectile = {type:'arrow-projectile',active:false,weaponItem:null,x:0,y:0,direction:2,vectorX:0,vectorY:0,angle:Math.PI/2,elapsed:0,distance:0,maxDistance:0,speed:720,phase:'outbound',impactElapsed:0,hitApplied:false};
var  stoneProjectile = {type:'stone-projectile',active:false,weaponItem:null,x:0,y:0,direction:2,vectorX:0,vectorY:0,angle:0,elapsed:0,distance:0,maxDistance:0,speed:600,phase:'outbound',impactElapsed:0,hitApplied:false};
var  magicProjectile = {type:'magic-projectile',active:false,weaponItem:null,x:0,y:0,direction:2,vectorX:0,vectorY:0,angle:Math.PI/2,elapsed:0,distance:0,maxDistance:0,speed:620,phase:'outbound',impactElapsed:0,hitApplied:false};
var  stoneProjectileSprite=document.createElement('canvas');
  stoneProjectileSprite.width=10;
  stoneProjectileSprite.height=8;
var  stoneSpriteContext=stoneProjectileSprite.getContext('2d');
  stoneSpriteContext.fillStyle='#41413e';
  stoneSpriteContext.fillRect(3,0,4,1);
  stoneSpriteContext.fillRect(1,1,8,1);
  stoneSpriteContext.fillRect(0,2,10,4);
  stoneSpriteContext.fillRect(1,6,8,1);
  stoneSpriteContext.fillRect(3,7,5,1);
  stoneSpriteContext.fillStyle='#827f76';
  stoneSpriteContext.fillRect(2,1,5,1);
  stoneSpriteContext.fillRect(1,2,7,1);
  stoneSpriteContext.fillRect(1,3,5,2);
  stoneSpriteContext.fillRect(2,5,5,1);
  stoneSpriteContext.fillStyle='#c9c2b4';
  stoneSpriteContext.fillRect(2,2,3,1);
  stoneSpriteContext.fillRect(2,3,2,1);
  stoneSpriteContext.fillStyle='#5a5852';
  stoneSpriteContext.fillRect(6,4,2,1);
  stoneSpriteContext.fillRect(5,5,3,1);
  stoneSpriteContext.fillRect(4,6,4,1);
var  fileColorFallback = false;
var  imageCache = new Map();
var  damageTintCache = new WeakMap();
var  arrowProjectileBoundsCache = new Map();
var  keys = new Set();
var  rightMouseHeld = false;
var  shieldStaminaExhausted = false;
var  player = {x:0,y:0,direction:2,knockback:null,knockbackHeight:0};
  // player.x/y guardam somente a última posição confirmada pelo servidor.
  // playerVisual é exclusivamente uma interpolação de desenho entre respostas.
var  playerVisual = {x:0,y:0,targetX:0,targetY:0,initialized:false};
  // Posição fixa no mundo: não acompanha o deslocamento do jogador.
var  camera = {x:0,y:0};

  function setAuthoritativePlayerPosition(x,y,direction,snap=false) {
    const serverX=Number(x),serverY=Number(y);
    if(!Number.isFinite(serverX)||!Number.isFinite(serverY)) return false;
    camera.x=0; camera.y=0;
    player.x=serverX; player.y=serverY;
    if(Number.isFinite(Number(direction))) {
      player.direction=Math.max(0,Math.min(3,Number(direction)));
    }
    if(snap||!playerVisual.initialized) {
      playerVisual.x=serverX; playerVisual.y=serverY;
      playerVisual.targetX=serverX; playerVisual.targetY=serverY;
      playerVisual.initialized=true;
    } else {
      playerVisual.targetX=serverX;
      playerVisual.targetY=serverY;
    }
    return true;
  }

  function updateLocalPlayerVisual(deltaSeconds) {
    if(!playerVisual.initialized) {
      setAuthoritativePlayerPosition(player.x,player.y,player.direction,true);
      return;
    }
    const dt=Math.max(0,Math.min(.05,Number(deltaSeconds)||0));
    const blend=1-Math.exp(-dt*24);
    const maxStep=520*dt;
    const dx=playerVisual.targetX-playerVisual.x;
    const dy=playerVisual.targetY-playerVisual.y;
    const stepX=Math.sign(dx)*Math.min(Math.abs(dx*blend),maxStep);
    const stepY=Math.sign(dy)*Math.min(Math.abs(dy*blend),maxStep);
    playerVisual.x+=stepX;
    playerVisual.y+=stepY;
    if(Math.abs(playerVisual.targetX-playerVisual.x)<.15) playerVisual.x=playerVisual.targetX;
    if(Math.abs(playerVisual.targetY-playerVisual.y)<.15) playerVisual.y=playerVisual.targetY;
  }
var  TILE = 72;
var  SPEED = 225;
var  COLLISION_RADIUS = 18;
var  NEARBY_INFO_RADIUS = 80;
var  remotePlayers = new Map();
var  inventory = [null, null];
var  selectedInventorySlot = 0;
var  draggedWearableIndex = -1;
var  suppressWearSlotClick = false;
var  equipmentCatalog = window.KTKEquipmentCatalog;
var  playerStats = window.KTKPlayerStats;
var  arrowSpriteItem = equipmentCatalog?.items.find(item=>item.id==='equipment-arrow')||null;
var  worldItems = new Set();
var  serverWorldEntities = new Map();
var  serverEntityRevisions = new Map();
var  lastServerInventorySignature = null;
var  lastServerWearablesSignature = null;
var  lastServerSelectedSlot = null;
var  crownRealtimeSeen = false;
var  kingCrownClaimedBy = null;
var  wearableSlotOrder = ['head','chest','waist','legs','feet'];
var  equippedWearables = Object.fromEntries(wearableSlotOrder.map(slot=>[slot,null]));
var  startingWearables = { chest: 'cosmetic-linen-shirt', legs: 'cosmetic-trousers', feet: 'cosmetic-shoes' };
  function equipStartingWearables() {
    wearableSlotOrder.forEach(slot=>{equippedWearables[slot]=null;});
    Object.entries(startingWearables).forEach(([slot,id])=>{
      const item=equipmentCatalog?.items.find(entry=>entry.id===id);
      if(!item) return;
      item.collected=true;
      const equippedItem={...item,collected:true,x:0,y:0,isStartingWearable:true};
      equippedWearables[slot]=equippedItem;
      if(item.image&&!item.image.complete) {
        item.image.addEventListener('load',()=>{
          equippedItem.iconCanvas=item.iconCanvas;
          renderWearableSlots();
        },{once:true});
        item.image.addEventListener('error',renderWearableSlots,{once:true});
      }
    });
  }
  equipStartingWearables();
var  armorDamageCursor = 0;
  function getInnateMagicProfile(level=playerStats?.stats.magicLevel.value||0) {
    const wand=equipmentCatalog?.items.find(item=>item.id==='equipment-wand');
    const levelManaMultiplier=level>=9?1:2;
    const levelStaminaMultiplier=level>=10?0:level>=7?0.5:1;
    return {
      attackBonus:Number(wand?.attackBonus)||6,
      range:(Number(wand?.range)||7)*0.5,
      attackType:wand?.attackType||'slash',
      attackFrameCount:Number(wand?.attackFrameCount)||6,
      manaCost:(Number(wand?.manaCost)||5)*levelManaMultiplier,
      staminaCost:PUNCH_STAMINA_COST*levelStaminaMultiplier,
      damageMultiplier:level>=7?2:1
    };
  }
  function getBlockingShield() {
    if (inventory[selectedInventorySlot]?.twoHanded) return null;
    return inventory.find(item=>item?.equipmentClass==='shield') || null;
  }
  playerStats?.setEquipmentAttackBonusProvider(() => {
    const selectedItem=inventory[selectedInventorySlot];
    const magicLevel=playerStats?.stats.magicLevel.value||0;
    if(magicLevel>=6&&!isMagicWeapon(selectedItem)) {
      const profile=getInnateMagicProfile(magicLevel);
      return window.KTKPlayerStats.canConsumeMana(profile.manaCost)
        ? Math.max(0,profile.attackBonus)
        : 0;
    }
    return Math.max(0,Number(selectedItem?.attackBonus)||0);
  });
  playerStats?.setEquipmentDefenseMultiplierProvider(() => {
    return rightMouseHeld && !shieldStaminaExhausted && getBlockingShield() ? 2 : 1;
  });
  playerStats?.setEquipmentArmorDefenseProvider(() => wearableSlotOrder.reduce((sum,slot)=>{
    const item=equippedWearables[slot];
    return sum+(item?.wearCategory==='armor'&&item.durability>0?(Number(item.armorDefense)||0):0);
  },0));
  playerStats?.setEquipmentSpeedPenaltyProvider(() => wearableSlotOrder.reduce((sum,slot)=>{
    const item=equippedWearables[slot];
    return sum+(item?.durability>0?(Number(item.speedPenalty)||0):0);
  },0));