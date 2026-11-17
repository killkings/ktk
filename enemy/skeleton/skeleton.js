// Inimigo esqueleto estático. Os sprites vêm do conjunto Universal LPC.
(() => {
  'use strict';

  const WORLD_SCALE = 1.28;
  const images = new Map();
  const damageTintCache = new WeakMap();
  const skeleton = {
    id: 'skeleton-1',
    type: 'enemy',
    creatureType: 'undead',
    x: 92,
    y: 0,
    direction: 1,
    radius: 18,
    health: 60,
    maxHealth: 100,
    satiety: 99,
    maxSatiety: 99,
    hydration: 99,
    maxHydration: 99,
    stamina: 99,
    maxStamina: 99,
    attack: 7,
    defense: 6,
    defeated: false,
    attackCooldown: 0.5,
    attacking: false,
    attackElapsed: 0,
    attackHitApplied: false,
    knockback: null,
    knockbackHeight: 0,
    frameWidth: 64,
    frameHeight: 64,
    frameCount: 2,
    layers: [
      { path: 'body/bodies/skeleton/idle.png', z: 0 },
      { path: 'head/heads/skeleton/adult/idle.png', z: 100 }
    ]
  };

  function loadImage(path) {
    if (!images.has(path)) {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.src = window.KTKLPC_CONFIG.spritesRoot + path;
      images.set(path, image);
    }
    return images.get(path);
  }

  function getDamageTintedSprite(image) {
    if (damageTintCache.has(image)) return damageTintCache.get(image);
    const tinted = document.createElement('canvas');
    tinted.width = image.width;
    tinted.height = image.height;
    const tintContext = tinted.getContext('2d');
    tintContext.drawImage(image, 0, 0);
    tintContext.globalCompositeOperation = 'source-in';
    tintContext.fillStyle = '#ff2626';
    tintContext.fillRect(0, 0, tinted.width, tinted.height);
    damageTintCache.set(image, tinted);
    return tinted;
  }

  function draw(ctx, screenX, screenY, time) {
    const left = screenX - skeleton.frameWidth * WORLD_SCALE / 2;
    const top = screenY - (skeleton.knockbackHeight || 0) - skeleton.frameHeight * WORLD_SCALE / 2;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    skeleton.layers.slice().sort((a, b) => a.z - b.z).forEach(layer => {
      const remoteAttackActive=Boolean(skeleton.remoteAttacking);
      const attacking=skeleton.attacking||remoteAttackActive;
      const attackElapsed=remoteAttackActive?skeleton.remoteAttackElapsed:skeleton.attackElapsed;
      const direction=remoteAttackActive?skeleton.remoteAttackDirection:skeleton.direction;
      const animation = attacking ? 'slash' : 'idle';
      const image = loadImage(layer.path.replace('/idle.png', `/${animation}.png`));
      if (!image.complete || !image.naturalWidth) return;
      const sprite = skeleton.knockback ? getDamageTintedSprite(image) : image;
      const columns = Math.max(1, Math.floor(image.naturalWidth / skeleton.frameWidth));
      const frame = attacking
        ? Math.min(columns - 1, Math.floor((attackElapsed / 0.42) * columns))
        : Math.floor(time * 2) % skeleton.frameCount;
      ctx.drawImage(
        sprite,
        (frame % columns) * skeleton.frameWidth,
        direction * skeleton.frameHeight,
        skeleton.frameWidth,
        skeleton.frameHeight,
        left,
        top,
        skeleton.frameWidth * WORLD_SCALE,
        skeleton.frameHeight * WORLD_SCALE
      );
    });
    ctx.restore();
  }

  window.KTKEnemySkeleton = { entity: skeleton, draw };
})();
