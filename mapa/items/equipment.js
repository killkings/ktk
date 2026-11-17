// Cadastro dos equipamentos iniciais e organizacao das fileiras no mapa central.
(() => {
  'use strict';

  const SPRITE_ROOT = './Universal-LPC-Spritesheet-Character-Generator-master/spritesheets/';
  const FRAME_SIZE = 64;

  const MATERIAL_ORDER = ['brass', 'bronze', 'ceramic', 'copper', 'gold', 'iron', 'silver', 'steel'];
  const MATERIAL_COLORS = {
    brass: { name: 'Brass', hex: '#c5a64d' },
    bronze: { name: 'Bronze', hex: '#a96b42' },
    ceramic: { name: 'Ceramic', hex: '#d6d0c2' },
    copper: { name: 'Copper', hex: '#b87345' },
    gold: { name: 'Gold', hex: '#e2bd4f' },
    iron: { name: 'Iron', hex: '#737a80' },
    silver: { name: 'Silver', hex: '#c2cbd2' },
    steel: { name: 'Steel', hex: '#8293a1' }
  };
  const ARMOR_DETAILS = {
    brass: { sleeves: true },
    bronze: { sleeves: true, gloves: true },
    ceramic: { gloves: true },
    copper: { sleeves: true, gloves: true },
    gold: {},
    iron: { sleeves: true },
    silver: { gloves: true },
    steel: { sleeves: true, gloves: true }
  };
  const MATERIAL_STATS = {
    copper: { name: 'Copper', attack: 0.85, durability: 0.70, stamina: 0.90, work: 0.80, armorDefense: 0.60, armorDurability: 0.75, armorSpeedPenalty: 0.04 },
    brass: { name: 'Brass', attack: 0.90, durability: 0.85, stamina: 1.00, work: 0.90, armorDefense: 0.70, armorDurability: 0.80, armorSpeedPenalty: 0.07 },
    bronze: { name: 'Bronze', attack: 1.00, durability: 1.00, stamina: 1.00, work: 1.00, armorDefense: 0.90, armorDurability: 0.95, armorSpeedPenalty: 0.08 },
    iron: { name: 'Iron', attack: 1.05, durability: 1.15, stamina: 1.10, work: 1.10, armorDefense: 1.00, armorDurability: 1.00, armorSpeedPenalty: 0.12 },
    steel: { name: 'Steel', attack: 1.15, durability: 1.35, stamina: 1.20, work: 1.25, armorDefense: 1.20, armorDurability: 1.30, armorSpeedPenalty: 0.14 },
    silver: { name: 'Silver', attack: 0.95, durability: 0.80, stamina: 1.05, work: 0.90, armorDefense: 0.90, armorDurability: 0.85, armorSpeedPenalty: 0.08 },
    gold: { name: 'Gold', attack: 0.85, durability: 0.60, stamina: 1.20, work: 0.70, armorDefense: 0.75, armorDurability: 0.65, armorSpeedPenalty: 0.18 },
    ceramic: { name: 'Ceramic', attack: 1.00, edgedAttack: 1.10, bluntAttack: 0.85, durability: 0.45, stamina: 0.90, work: 0.55, armorDefense: 1.15, armorDurability: 0.55, armorSpeedPenalty: 0.02 }
  };

  // Only list equipment with actual material-colored LPC spritesheets.
  const MATERIAL_SPRITE_VARIANTS = {
    'arming-sword': {
      attackType: 'edged',
      sprites: material => ({
        sprite: `weapon/sword/arming/universal/fg/walk/${material}.png`,
        heldBackgroundSprite: `weapon/sword/arming/universal/bg/walk/${material}.png`,
        attackSprite: `weapon/sword/arming/attack_halfslash/fg/${material}.png`,
        attackBackgroundSprite: `weapon/sword/arming/attack_halfslash/bg/${material}.png`,
        iconSprite: null
      })
    },
    'bow-normal': {
      attackType: 'other',
      sprites: material => ({
        sprite: `weapon/ranged/bow/normal/walk/foreground/${material}.png`,
        heldBackgroundSprite: `weapon/ranged/bow/normal/walk/background/${material}.png`,
        attackSprite: `weapon/ranged/bow/normal/universal/foreground/shoot/${material}.png`,
        attackBackgroundSprite: `weapon/ranged/bow/normal/universal/background/shoot/${material}.png`,
        iconSprite: `weapon/ranged/bow/normal/universal/foreground/shoot/${material}.png`
      })
    },
    'bow-great': {
      attackType: 'other',
      sprites: material => ({
        sprite: `weapon/ranged/bow/great/walk/foreground/${material}.png`,
        heldBackgroundSprite: `weapon/ranged/bow/great/walk/background/${material}.png`,
        attackSprite: `weapon/ranged/bow/great/universal/foreground/shoot/${material}.png`,
        iconSprite: `weapon/ranged/bow/great/universal/foreground/shoot/${material}.png`
      })
    },
    'bow-recurve': {
      attackType: 'other',
      sprites: material => ({
        sprite: `weapon/ranged/bow/recurve/walk/foreground/${material}.png`,
        heldBackgroundSprite: `weapon/ranged/bow/recurve/walk/background/${material}.png`,
        attackSprite: `weapon/ranged/bow/recurve/universal/foreground/shoot/${material}.png`,
        attackBackgroundSprite: `weapon/ranged/bow/recurve/universal/background/shoot/${material}.png`,
        iconSprite: `weapon/ranged/bow/recurve/universal/foreground/shoot/${material}.png`
      })
    },
    'dragon-spear': {
      attackType: 'edged',
      sprites: material => ({
        sprite: `weapon/polearm/dragonspear/foreground/walk/${material}.png`,
        heldBackgroundSprite: `weapon/polearm/dragonspear/background/walk/${material}.png`,
        attackSprite: `weapon/polearm/dragonspear/foreground/thrust/${material}.png`,
        attackBackgroundSprite: `weapon/polearm/dragonspear/background/thrust/${material}.png`,
        iconSprite: null
      })
    },
    'long-spear': {
      attackType: 'edged',
      sprites: material => ({
        sprite: `weapon/polearm/longspear/foreground/walk/${material}.png`,
        heldBackgroundSprite: `weapon/polearm/longspear/background/walk/${material}.png`,
        attackSprite: `weapon/polearm/longspear/foreground/thrust/${material}.png`,
        attackBackgroundSprite: `weapon/polearm/longspear/background/thrust/${material}.png`,
        iconSprite: null
      })
    },
    spear: {
      attackType: 'edged',
      sprites: material => ({
        sprite: `weapon/polearm/spear/foreground/walk/${material}.png`,
        heldBackgroundSprite: `weapon/polearm/spear/background/walk/${material}.png`,
        attackSprite: `weapon/polearm/spear/foreground/thrust/${material}.png`,
        attackBackgroundSprite: `weapon/polearm/spear/background/thrust/${material}.png`,
        iconSprite: null
      })
    },
    trident: {
      attackType: 'edged',
      sprites: material => ({
        sprite: `weapon/polearm/trident/foreground/walk/${material}.png`,
        heldBackgroundSprite: `weapon/polearm/trident/background/walk/${material}.png`,
        attackSprite: `weapon/polearm/trident/foreground/thrust/${material}.png`,
        attackBackgroundSprite: `weapon/polearm/trident/background/thrust/${material}.png`,
        iconSprite: null
      })
    },
    'diamond-staff': {
      attackType: 'other',
      sprites: material => ({
        sprite: `weapon/magic/diamond/universal/foreground/walk/${material}.png`,
        heldBackgroundSprite: `weapon/magic/diamond/universal/background/walk/${material}.png`,
        attackSprite: `weapon/magic/diamond/thrust/foreground/${material}.png`,
        attackBackgroundSprite: `weapon/magic/diamond/thrust/background/${material}.png`,
        iconSprite: null
      })
    },
    'gnarled-staff': {
      attackType: 'other',
      sprites: material => ({
        sprite: `weapon/magic/gnarled/universal/foreground/walk/${material}.png`,
        heldBackgroundSprite: `weapon/magic/gnarled/universal/background/walk/${material}.png`,
        attackSprite: `weapon/magic/gnarled/thrust/foreground/${material}.png`,
        attackBackgroundSprite: `weapon/magic/gnarled/thrust/background/${material}.png`,
        iconSprite: null
      })
    },
    'loop-staff': {
      attackType: 'other',
      sprites: material => ({
        sprite: `weapon/magic/loop/universal/foreground/walk/${material}.png`,
        heldBackgroundSprite: `weapon/magic/loop/universal/background/walk/${material}.png`,
        attackSprite: `weapon/magic/loop/thrust/foreground/${material}.png`,
        attackBackgroundSprite: `weapon/magic/loop/thrust/background/${material}.png`,
        iconSprite: null
      })
    },
    's-staff': {
      attackType: 'other',
      sprites: material => ({
        sprite: `weapon/magic/s/universal/foreground/walk/${material}.png`,
        heldBackgroundSprite: `weapon/magic/s/universal/background/walk/${material}.png`,
        attackSprite: `weapon/magic/s/thrust/foreground/${material}.png`,
        attackBackgroundSprite: `weapon/magic/s/thrust/background/${material}.png`,
        iconSprite: null
      })
    }
  };

  function getMaterialAttackMultiplier(material, attackType) {
    const stats = MATERIAL_STATS[material];
    if (!stats) return 1;
    if (material === 'ceramic') {
      if (attackType === 'edged') return stats.edgedAttack;
      if (attackType === 'blunt') return stats.bluntAttack;
    }
    return stats.attack;
  }

  function scaleMaterialStat(value, multiplier) {
    const base = Number(value) || 0;
    return base > 0 ? Math.max(1, Math.round(base * multiplier)) : 0;
  }

  function scaleWorkEfficiency(value, multiplier) {
    const base = Number(value) || 0;
    return base > 0 ? Math.round(base * multiplier * 100) / 100 : 0;
  }

  const ATTACK_ANIMATIONS = {
    'two-engrailed-shield': { attackSprite: 'shield/two_engrailed/fg/male/slash/two_engrailed.png', attackType: 'slash', attackFrameSize: 64, attackFrameCount: 6 },
    'scutum-shield': { attackSprite: 'shield/scutum/paint/fg/male/slash/scutum.png', attackType: 'slash', attackFrameSize: 64, attackFrameCount: 6 },
    'heater-shield': { attackSprite: 'shield/heater/original/paint/fg/slash.png', attackType: 'slash', attackFrameSize: 64, attackFrameCount: 6 },
    'round-shield': { attackSprite: 'shield/round/slash/brown.png', attackType: 'slash', attackFrameSize: 64, attackFrameCount: 6 },
    'kite-shield': { attackSprite: 'shield/kite/female/slash/kite_gray.png', attackType: 'slash', attackFrameSize: 64, attackFrameCount: 6 },
    'spartan-shield': { attackSprite: 'shield/spartan/fg/slash/spartan.png', attackType: 'slash', attackFrameSize: 64, attackFrameCount: 6 },

    'bow-normal': { attackSprite: 'weapon/ranged/bow/normal/universal/foreground/shoot/normal.png', attackType: 'shoot', attackFrameSize: 64, attackFrameCount: 13 },
    'bow-great': { attackSprite: 'weapon/ranged/bow/great/universal/foreground/shoot/great.png', attackType: 'shoot', attackFrameSize: 64, attackFrameCount: 13 },
    'bow-recurve': { attackSprite: 'weapon/ranged/bow/recurve/universal/foreground/shoot/recurve.png', attackType: 'shoot', attackFrameSize: 64, attackFrameCount: 13 },
    'crossbow': { attackSprite: 'weapon/ranged/crossbow/foreground/thrust/crossbow.png', attackType: 'thrust', attackFrameSize: 64, attackFrameCount: 8 },
    'slingshot': { attackSprite: 'weapon/ranged/slingshot/foreground/shoot/slingshot.png', attackType: 'shoot', attackFrameSize: 64, attackFrameCount: 13 },
    // O LPC só fornece uma animação grande para o bumerangue. Ela é usada como pose parada ao caminhar.
    'boomerang': { attackType: 'shoot', attackUsesHeldSprite: true, attackFrameSize: 192, attackFrameCount: 6 },

    'arming-sword': { attackSprite: 'weapon/sword/arming/attack_halfslash/fg.png', attackBackgroundSprite: 'weapon/sword/arming/attack_halfslash/bg.png', attackType: 'slash', attackFrameSize: 128, attackFrameCount: 6 },
    'dagger': { attackSprite: 'weapon/sword/dagger/slash/dagger.png', attackType: 'slash', attackFrameSize: 64, attackFrameCount: 6 },
    'glowsword': { attackSprite: 'weapon/sword/glowsword/attack_slash/red.png', attackType: 'slash', attackFrameSize: 192, attackFrameCount: 6 },
    'katana': { attackSprite: 'weapon/sword/katana/slash/katana.png', attackBackgroundSprite: 'weapon/sword/katana/slash/behind/katana.png', attackType: 'slash', attackFrameSize: 128, attackFrameCount: 6 },
    'rapier': { attackSprite: 'weapon/sword/rapier/attack_slash/rapier.png', attackBackgroundSprite: 'weapon/sword/rapier/attack_slash/behind/rapier.png', attackType: 'slash', attackFrameSize: 192, attackFrameCount: 6 },
    'saber': { attackSprite: 'weapon/sword/saber/attack_slash/saber.png', attackBackgroundSprite: 'weapon/sword/saber/attack_slash/behind/saber.png', attackType: 'slash', attackFrameSize: 192, attackFrameCount: 6 },
    'scimitar': { attackSprite: 'weapon/sword/scimitar/slash/scimitar.png', attackBackgroundSprite: 'weapon/sword/scimitar/slash/behind/scimitar.png', attackType: 'slash', attackFrameSize: 128, attackFrameCount: 6 },

    'club': { attackType: 'slash', attackUsesHeldSprite: true, attackFrameSize: 192, attackDisplaySize: 192, attackFrameCount: 6, attackBackgroundZ: 9, attackReverseBodyFrames: true },
    'flail': { attackSprite: 'weapon/blunt/flail/attack_slash/flail.png', attackBackgroundSprite: 'weapon/blunt/flail/attack_slash/behind/flail.png', attackType: 'slash', attackFrameSize: 192, attackFrameCount: 6 },
    'mace': { attackSprite: 'weapon/blunt/mace/attack_slash/mace.png', attackBackgroundSprite: 'weapon/blunt/mace/attack_slash/behind/mace.png', attackType: 'slash', attackFrameSize: 192, attackFrameCount: 6 },
    'waraxe': { attackSprite: 'weapon/blunt/waraxe/attack_slash/waraxe.png', attackBackgroundSprite: 'weapon/blunt/waraxe/attack_slash/behind/waraxe.png', attackType: 'slash', attackFrameSize: 192, attackFrameCount: 6 },

    'cane': { attackSprite: 'weapon/polearm/cane/male/thrust/cane.png', attackType: 'thrust', attackFrameSize: 64, attackFrameCount: 8 },
    'dragon-spear': { attackSprite: 'weapon/polearm/dragonspear/foreground/thrust/dragonspear.png', attackBackgroundSprite: 'weapon/polearm/dragonspear/background/thrust/dragonspear.png', attackType: 'thrust', attackFrameSize: 192, attackFrameCount: 8 },
    'halberd': { attackSprite: 'weapon/polearm/halberd/attack_thrust/halberd.png', attackBackgroundSprite: 'weapon/polearm/halberd/attack_thrust/behind/halberd.png', attackType: 'thrust', attackFrameSize: 192, attackFrameCount: 8 },
    'long-spear': { attackSprite: 'weapon/polearm/longspear/foreground/thrust/longspear.png', attackBackgroundSprite: 'weapon/polearm/longspear/background/thrust/longspear.png', attackType: 'thrust', attackFrameSize: 192, attackFrameCount: 8 },
    'scythe': { attackSprite: 'weapon/polearm/scythe/attack_slash/scythe.png', attackType: 'slash', attackFrameSize: 192, attackFrameCount: 6 },
    'spear': { attackSprite: 'weapon/polearm/spear/foreground/thrust/spear.png', attackBackgroundSprite: 'weapon/polearm/spear/background/thrust/spear.png', attackType: 'thrust', attackFrameSize: 64, attackFrameCount: 8 },
    'trident': { attackSprite: 'weapon/polearm/trident/foreground/thrust/trident.png', attackBackgroundSprite: 'weapon/polearm/trident/background/thrust/trident.png', attackType: 'thrust', attackFrameSize: 192, attackFrameCount: 8 },

    'crystal': { attackSprite: 'weapon/magic/crystal/thrust/foreground.png', attackBackgroundSprite: 'weapon/magic/crystal/thrust/background.png', attackType: 'thrust', attackFrameSize: 192, attackFrameCount: 8 },
    'diamond-staff': { attackSprite: 'weapon/magic/diamond/thrust/foreground.png', attackBackgroundSprite: 'weapon/magic/diamond/thrust/background.png', attackType: 'thrust', attackFrameSize: 192, attackFrameCount: 8 },
    'gnarled-staff': { attackSprite: 'weapon/magic/gnarled/thrust/foreground.png', attackBackgroundSprite: 'weapon/magic/gnarled/thrust/background.png', attackType: 'thrust', attackFrameSize: 192, attackFrameCount: 8 },
    'loop-staff': { attackSprite: 'weapon/magic/loop/thrust/foreground.png', attackBackgroundSprite: 'weapon/magic/loop/thrust/background.png', attackType: 'thrust', attackFrameSize: 192, attackFrameCount: 8 },
    's-staff': { attackSprite: 'weapon/magic/s/thrust/foreground.png', attackBackgroundSprite: 'weapon/magic/s/thrust/background.png', attackType: 'thrust', attackFrameSize: 192, attackFrameCount: 8 },
    'simple-staff': { attackSprite: 'weapon/magic/simple/foreground/thrust/simple.png', attackBackgroundSprite: 'weapon/magic/simple/background/thrust/simple.png', attackType: 'thrust', attackFrameSize: 64, attackFrameCount: 8 },
    // Wand não tem animação de caminhada no catálogo LPC; usa o primeiro quadro como pose de mão.
    'wand': { attackSprite: 'weapon/magic/wand/male/slash/wand.png', attackType: 'slash', attackFrameSize: 64, attackFrameCount: 6 },

    // As ferramentas abaixo usam folhas de ataque próprias, não as folhas de caminhada.
    'axe': { attackSprite: 'tools/axe/fg.png', attackBackgroundSprite: 'tools/axe/bg.png', attackType: 'slash', attackFrameSize: 128, attackFrameCount: 10 },
    'hammer': { attackSprite: 'tools/hammer/fg.png', attackBackgroundSprite: 'tools/hammer/bg.png', attackType: 'slash', attackFrameSize: 128, attackFrameCount: 9 },
    'pickaxe': { attackSprite: 'tools/pickaxe/fg.png', attackBackgroundSprite: 'tools/pickaxe/bg.png', attackType: 'slash', attackFrameSize: 128, attackFrameCount: 10 },
    'rod': { attackSprite: 'tools/fishing_rod/fg.png', attackBackgroundSprite: 'tools/fishing_rod/bg.png', attackType: 'thrust', attackFrameSize: 128, attackFrameCount: 13 },
    'hoe': { attackSprite: 'tools/hoe/fg/thrust.png', attackType: 'thrust', attackFrameSize: 64, attackFrameCount: 8 },
    'shovel': { attackSprite: 'tools/shovel/fg/thrust.png', attackType: 'thrust', attackFrameSize: 64, attackFrameCount: 8 },
    'watering-can': { attackSprite: 'tools/watering_can/fg/thrust.png', attackType: 'thrust', attackFrameSize: 64, attackFrameCount: 8 },
    'whip': { attackType: 'slash', attackUsesHeldSprite: true, attackFrameSize: 192, attackFrameCount: 8 }
  };

  function inferredFrameSize(image, preferredSize) {
    if (preferredSize) return preferredSize;
    // As armas LPC podem usar quadros de 64, 128 ou 192 px.
    // Os tamanhos fora do padrão são declarados no cadastro de cada item.
    return FRAME_SIZE;

  }

  function fitIcon(image, frameSize, staticFrame = null, maxSize = 50, staticRow = null) {
    const imageWidth = image.naturalWidth || image.width;
    const imageHeight = image.naturalHeight || image.height;
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = imageWidth;
    sourceCanvas.height = imageHeight;
    const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
    sourceContext.drawImage(image, 0, 0);

    const columns = Math.max(1, Math.floor(imageWidth / frameSize));
    const rows = Math.max(1, Math.floor(imageHeight / frameSize));
    let chosen = null;
    let bestScore = 0;

    try {
      const firstRow = Number.isInteger(staticRow) ? Math.max(0, Math.min(rows - 1, staticRow)) : 0;
      const lastRow = Number.isInteger(staticRow) ? firstRow + 1 : rows;
      const firstColumn = Number.isInteger(staticFrame) ? Math.max(0, Math.min(columns - 1, staticFrame)) : 0;
      const lastColumn = Number.isInteger(staticFrame) ? firstColumn + 1 : columns;
      for (let row = firstRow; row < lastRow; row++) {
        for (let column = firstColumn; column < lastColumn; column++) {
          const pixels = sourceContext.getImageData(column * frameSize, row * frameSize, frameSize, frameSize).data;
          let minX = frameSize;
          let minY = frameSize;
          let maxX = -1;
          let maxY = -1;
          let count = 0;
          for (let y = 0; y < frameSize; y++) {
            for (let x = 0; x < frameSize; x++) {
              if (pixels[(y * frameSize + x) * 4 + 3] < 24) continue;
              count++;
              minX = Math.min(minX, x);
              minY = Math.min(minY, y);
              maxX = Math.max(maxX, x);
              maxY = Math.max(maxY, y);
            }
          }
          const boundsWidth = maxX - minX + 1;
          const boundsHeight = maxY - minY + 1;
          const score = count * Math.min(boundsWidth, boundsHeight);
          if (count && score > bestScore) {
            bestScore = score;
            chosen = { x: column * frameSize + minX, y: row * frameSize + minY, width: boundsWidth, height: boundsHeight };
          }
        }
      }
    } catch (error) {
      chosen = null;
    }

    const icon = document.createElement('canvas');
    icon.width = FRAME_SIZE;
    icon.height = FRAME_SIZE;
    const context = icon.getContext('2d');
    if (!chosen) {
      const column = Number.isInteger(staticFrame)
        ? Math.max(0, Math.min(columns - 1, staticFrame))
        : Math.floor(columns / 2);
      const row = Number.isInteger(staticRow)
        ? Math.max(0, Math.min(rows - 1, staticRow))
        : Math.min(2, rows - 1);
      const sourceX = column * frameSize;
      const sourceY = row * frameSize;
      const sourceWidth = Math.min(frameSize, imageWidth - sourceX);
      const sourceHeight = Math.min(frameSize, imageHeight - sourceY);
      const drawSize = Math.min(maxSize, FRAME_SIZE);
      const offset = (FRAME_SIZE - drawSize) / 2;
      context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, offset, offset, drawSize, drawSize);
      return icon;
    }

    const scale = Math.min(maxSize / chosen.width, maxSize / chosen.height);
    const width = chosen.width * scale;
    const height = chosen.height * scale;
    context.imageSmoothingEnabled = false;
    context.drawImage(
      image,
      chosen.x, chosen.y, chosen.width, chosen.height,
      (FRAME_SIZE - width) / 2, (FRAME_SIZE - height) / 2, width, height
    );
    return icon;
  }

  function createConfiguredIcon(image, config, item) {
    return fitIcon(image, item.iconFrameSize, config.iconStaticFrame, item.iconFillSize, config.iconStaticRow);
  }

  function tintPalette(hex) {
    const rgb = hex.match(/[0-9a-f]{2}/gi).map(value => parseInt(value, 16));
    return [0.32, 0.45, 0.60, 0.76, 0.92, 1.08].map(factor =>
      `#${rgb.map(channel => Math.max(0, Math.min(255, Math.round(channel * factor))).toString(16).padStart(2, '0')).join('')}`
    );
  }

  function recolorItemSprite(image, mode) {
    const paletteHex = mode === 'black'
      ? ['#111111','#171717','#202020','#2b2b2b','#3b3b3b','#515151']
      : typeof mode === 'string' && /^#[0-9a-f]{6}$/i.test(mode) ? tintPalette(mode) : null;
    if (!paletteHex) return image;
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    try {
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const palette = paletteHex.map(color => color.match(/[0-9a-f]{2}/gi).map(value => parseInt(value, 16)));
      for (let index = 0; index < pixels.data.length; index += 4) {
        if (pixels.data[index + 3] === 0) continue;
        const luminance = (pixels.data[index] * 0.299 + pixels.data[index + 1] * 0.587 + pixels.data[index + 2] * 0.114) / 255;
        const paletteIndex = Math.max(0, Math.min(5, Math.round(luminance * 5)));
        const rgb = palette[paletteIndex];
        pixels.data[index] = rgb[0];
        pixels.data[index + 1] = rgb[1];
        pixels.data[index + 2] = rgb[2];
      }
      context.putImageData(pixels, 0, 0);
      return canvas;
    } catch (error) {
      return image;
    }
  }

  function createItem(config) {
    const item = {
      id: config.id,
      type: 'item',
      itemType: config.itemType || 'equipment',
      equipmentClass: config.equipmentClass,
      wearSlot: config.wearSlot || null,
      wearCategory: config.wearCategory || null,
      isKingCrown: Boolean(config.isKingCrown),
      armorDefense: Math.max(0, Number(config.armorDefense) || 0),
      speedPenalty: Math.max(0, Number(config.speedPenalty) || 0),
      appearanceLayers: Array.isArray(config.appearanceLayers) ? config.appearanceLayers : [],
      material: config.material || null,
      materialName: config.materialName || '',
      workEfficiency: Number.isFinite(Number(config.workEfficiency))
        ? Number(config.workEfficiency)
        : config.equipmentClass === 'tool' ? 1 : 0,
      materialDamageBonuses: config.materialDamageBonuses || {},
      twoHanded: Boolean(config.twoHanded),
      category: config.category,
      displayName: config.displayName,
      attackBonus: config.attackBonus || 0,
      range: config.range || 0,
      staminaCost: config.staminaCost || 0,
      attackInterval: config.attackInterval || 0,
      defenseBonus: config.defenseBonus || 0,
      blockStaminaCost: config.blockStaminaCost || 0,
      projectileSpeed: config.projectileSpeed || 0,
      manaCost: config.manaCost || 0,
      castTime: config.castTime || 0,
      ammoPerAttack: config.ammoPerAttack || 0,
      ammoKey: config.ammoKey || null,
      quantity: config.quantity,
      durability: config.durability || 0,
      maxDurability: config.durability || 0,
      durabilityUnit: config.durabilityUnit || '',
      iconFrameSize: config.iconFrameSize || FRAME_SIZE,
      iconSize: Number(config.iconSize) || 36,
      iconFillSize: Number(config.iconFillSize) || 50,
      heldFrameSize: Number(config.heldFrameSize) || FRAME_SIZE,
      heldDisplaySize: Number(config.heldDisplaySize) || FRAME_SIZE,
      attackDisplaySize: Number(config.attackDisplaySize) || 0,
      attackBackgroundZ: Number.isFinite(Number(config.attackBackgroundZ)) ? Number(config.attackBackgroundZ) : null,
      attackReverseBodyFrames: Boolean(config.attackReverseBodyFrames),
      attackFrameSize: Number(config.attackFrameSize) || 0,
      equipmentZ: Number.isFinite(Number(config.equipmentZ)) ? Number(config.equipmentZ) : 150,
      attackEquipmentZ: Number.isFinite(Number(config.attackEquipmentZ)) ? Number(config.attackEquipmentZ) : null,
      heldStaticFrame: Number.isInteger(config.heldStaticFrame) ? config.heldStaticFrame : null,
      heldBackgroundStaticFrame: Number.isInteger(config.heldBackgroundStaticFrame) ? config.heldBackgroundStaticFrame : null,
      attackFrameCount: Number(config.attackFrameCount) || 6,
      attackType: config.attackType || 'slash',
      radius: 12,
      collected: false,
      sourceX: 0,
      sourceY: 0,
      frameWidth: FRAME_SIZE,
      frameHeight: FRAME_SIZE
    };

    const image = new Image();
    item.image = image;
    image.onload = () => {
      const iconSource = recolorItemSprite(image, config.recolorMode);
      if (!config.iconSprite) item.iconCanvas = createConfiguredIcon(iconSource, config, item);
      item.heldFrameSize = inferredFrameSize(image, config.heldFrameSize);
      if (config.attackUsesHeldSprite) {
        item.attackImage = image;
        item.attackFrameSize = inferredFrameSize(image, config.attackFrameSize);
      }
    };
    image.onerror = () => console.warn('Sprite de equipamento nao encontrado:', config.sprite);
    image.src = SPRITE_ROOT + config.sprite;
    if (config.iconSprite) {
      const iconImage = new Image();
      item.iconImage = iconImage;
      iconImage.onload = () => { item.iconCanvas = createConfiguredIcon(iconImage, config, item); };
      iconImage.onerror = () => console.warn('Sprite de icone nao encontrado:', config.iconSprite);
      iconImage.src = SPRITE_ROOT + config.iconSprite;
    }
    if (config.attackSprite) {
      const attackImage = new Image();
      item.attackImage = attackImage;
      attackImage.onload = () => {
        item.attackFrameSize = inferredFrameSize(attackImage, config.attackFrameSize);
      };
      attackImage.onerror = () => console.warn('Sprite de ataque nao encontrado:', config.attackSprite);
      attackImage.src = SPRITE_ROOT + config.attackSprite;
    }
    if (config.attackBackgroundSprite) {
      const attackBackgroundImage = new Image();
      item.attackBackgroundImage = attackBackgroundImage;
      attackBackgroundImage.onload = () => { item.attackFrameSize = inferredFrameSize(attackBackgroundImage, config.attackFrameSize); };
      attackBackgroundImage.onerror = () => console.warn('Sprite de ataque nao encontrado:', config.attackBackgroundSprite);
      attackBackgroundImage.src = SPRITE_ROOT + config.attackBackgroundSprite;
    }
    if (config.heldBackgroundSprite) {
      const heldBackgroundImage = new Image();
      item.heldBackgroundImage = heldBackgroundImage;
      heldBackgroundImage.onload = () => { item.heldFrameSize = inferredFrameSize(heldBackgroundImage, config.heldFrameSize); };
      heldBackgroundImage.onerror = () => console.warn('Sprite de equipamento nao encontrado:', config.heldBackgroundSprite);
      heldBackgroundImage.src = SPRITE_ROOT + config.heldBackgroundSprite;
    }
    return item;
  }

  const sections = [
    {
      name: 'Shields', items: [
        ['two-engrailed-shield', 'Two-Engrailed Shield', 'shield', 0, 0, 0, 0, 160, 'blocks', 'shield/two_engrailed/fg/male/walk/two_engrailed.png', { defenseBonus: 4, blockStaminaCost: 2 }],
        ['scutum-shield', 'Scutum Shield', 'shield', 0, 0, 0, 0, 220, 'blocks', 'shield/scutum/paint/fg/male/walk/scutum.png', { defenseBonus: 6, blockStaminaCost: 3 }],
        ['heater-shield', 'Heater Shield', 'shield', 0, 0, 0, 0, 190, 'blocks', 'shield/heater/original/paint/fg/walk.png', { defenseBonus: 5, blockStaminaCost: 2 }],
        ['round-shield', 'Round Shield', 'shield', 0, 0, 0, 0, 150, 'blocks', 'shield/round/walk/brown.png', { defenseBonus: 3, blockStaminaCost: 1 }],
        ['kite-shield', 'Kite', 'shield', 0, 0, 0, 0, 200, 'blocks', 'shield/kite/female/walk/kite_gray.png', { defenseBonus: 5, blockStaminaCost: 2 }],
        ['spartan-shield', 'Spartan Shield', 'shield', 0, 0, 0, 0, 170, 'blocks', 'shield/spartan/fg/walk/spartan.png', { defenseBonus: 4, blockStaminaCost: 2 }]
      ]
    },
    {
      name: 'Ranged Weapons', items: [
        ['bow-normal', 'Bow - Normal', 'ranged', 7, 8, 5, 1.0, 120, 'shots', 'weapon/ranged/bow/normal/walk/foreground.png', { iconSprite: 'weapon/ranged/bow/normal/universal/foreground/shoot/normal.png', iconStaticFrame: 12, iconStaticRow: 1, iconFrameSize: 64, iconSize: 64, iconFillSize: 60, heldBackgroundSprite: 'weapon/ranged/bow/normal/universal/background/hurt/normal.png', heldBackgroundStaticFrame: 5, twoHanded: true }],
        ['bow-great', 'Bow - Great', 'ranged', 11, 11, 9, 1.5, 120, 'shots', 'weapon/ranged/bow/great/walk/foreground/great.png', { iconSprite: 'weapon/ranged/bow/great/universal/foreground/shoot/great.png', iconStaticFrame: 12, iconStaticRow: 1, iconFrameSize: 64, iconSize: 64, iconFillSize: 60, heldBackgroundSprite: 'weapon/ranged/bow/great/universal/background/hurt/great.png', heldBackgroundStaticFrame: 5, twoHanded: true }],
        ['bow-recurve', 'Bow - Recurve', 'ranged', 8, 9, 6, 0.75, 120, 'shots', 'weapon/ranged/bow/recurve/walk/foreground/recurve.png', { iconSprite: 'weapon/ranged/bow/recurve/universal/foreground/shoot/recurve.png', iconStaticFrame: 12, iconStaticRow: 1, iconFrameSize: 64, iconSize: 64, iconFillSize: 60, heldBackgroundSprite: 'weapon/ranged/bow/recurve/universal/background/hurt/recurve.png', heldBackgroundStaticFrame: 5, twoHanded: true }],
        ['crossbow', 'Crossbow', 'ranged', 12, 11, 8, 1.8, 120, 'shots', 'weapon/ranged/crossbow/foreground/walk/crossbow.png', { twoHanded: true }],
        ['slingshot', 'Slingshot', 'ranged', 4, 5, 2, 0.5, 80, 'shots', 'weapon/ranged/slingshot/foreground/walk/slingshot.png', { twoHanded: true }],
        ['boomerang', 'Boomerang', 'ranged', 6, 6, 4, 1.0, 160, 'throws', 'weapon/ranged/boomerang/boomerang.png', { iconFrameSize: 192, heldFrameSize: 192, heldDisplaySize: 64, heldStaticFrame: 0, equipmentZ: 80, attackEquipmentZ: 150, projectileSpeed: 480 }],
        ['arrow', 'Arrow', 'ammunition', 0, 0, 0, 0, 0, '', 'weapon/ranged/bow/arrow/shoot/arrow.png', { itemType: 'ammo', quantity: 1, ammoPerAttack: 1, ammoKey: 'arrow' }]
      ]
    },
    {
      name: 'Swords', items: [
        ['arming-sword', 'Arming Sword', 'melee', 8, 1.25, 6, 0.8, 150, 'hits', 'weapon/sword/arming/universal/walk/fg.png', { heldBackgroundSprite: 'weapon/sword/arming/universal/walk/bg.png' }],
        ['dagger', 'Dagger', 'melee', 4, 0.65, 2, 0.4, 120, 'uses', 'weapon/sword/dagger/walk/dagger.png'],
        ['glowsword', 'Glowsword', 'melee', 12, 1.4, 7, 0.7, 200, 'hits', 'weapon/sword/glowsword/walk/red.png'],
        ['katana', 'Katana', 'melee', 11, 1.35, 7, 0.75, 150, 'hits', 'weapon/sword/katana/walk/katana.png', { iconFrameSize: 128, heldFrameSize: 128, heldBackgroundSprite: 'weapon/sword/katana/walk/behind/katana.png', twoHanded: false }],
        ['longsword', 'Longsword', 'melee', 10, 1.5, 8, 1.0, 150, 'hits', 'weapon/sword/longsword/universal_behind/walk/longsword.png', { existingLongsword: true, twoHanded: false }],
        ['rapier', 'Rapier', 'melee', 7, 1.45, 5, 0.55, 120, 'uses', 'weapon/sword/rapier/walk/rapier.png', { heldBackgroundSprite: 'weapon/sword/rapier/universal_behind/walk/rapier.png' }],
        ['saber', 'Saber', 'melee', 8, 1.3, 6, 0.65, 150, 'hits', 'weapon/sword/saber/walk/saber.png', { heldBackgroundSprite: 'weapon/sword/saber/universal_behind/walk/saber.png' }],
        ['scimitar', 'Scimitar', 'melee', 9, 1.2, 6, 0.65, 150, 'hits', 'weapon/sword/scimitar/walk/scimitar.png', { iconFrameSize: 128, heldFrameSize: 128, heldBackgroundSprite: 'weapon/sword/scimitar/walk/behind/scimitar.png' }]
      ]
    },
    {
      name: 'Blunt Weapons', items: [
        ['club', 'Club', 'melee', 6, 1.0, 5, 0.85, 110, 'hits', 'weapon/blunt/club/club.png', { iconFrameSize: 192, heldFrameSize: 192, heldDisplaySize: 64, heldStaticFrame: 0, heldBackgroundSprite: 'weapon/blunt/club/background/club.png', equipmentZ: 80, attackEquipmentZ: 140, twoHanded: true }],
        ['flail', 'Flail', 'melee', 10, 1.35, 9, 1.15, 120, 'hits', 'weapon/blunt/flail/walk/flail.png', { heldBackgroundSprite: 'weapon/blunt/flail/behind/walk/flail.png' }],
        ['mace', 'Mace', 'melee', 11, 1.05, 8, 1.0, 130, 'hits', 'weapon/blunt/mace/walk/mace.png', { heldBackgroundSprite: 'weapon/blunt/mace/universal_behind/walk/mace.png' }],
        ['waraxe', 'Waraxe', 'melee', 12, 1.25, 10, 1.2, 140, 'hits', 'weapon/blunt/waraxe/walk/waraxe.png', { heldBackgroundSprite: 'weapon/blunt/waraxe/behind/walk/waraxe.png', twoHanded: true }]
      ]
    },
    {
      name: 'Polearms', items: [
        ['cane', 'Cane', 'melee', 3, 1.05, 3, 0.6, 100, 'hits', 'weapon/polearm/cane/male/walk/cane.png', { twoHanded: true }],
        ['dragon-spear', 'Dragon Spear', 'melee', 12, 1.9, 9, 1.15, 150, 'hits', 'weapon/polearm/dragonspear/foreground/walk/dragonspear.png', { iconFrameSize: 128, heldFrameSize: 128, heldDisplaySize: 128, heldBackgroundSprite: 'weapon/polearm/dragonspear/background/walk/dragonspear.png', twoHanded: true }],
        ['halberd', 'Halberd', 'melee', 13, 1.7, 11, 1.3, 150, 'hits', 'weapon/polearm/halberd/walk/halberd.png', { heldBackgroundSprite: 'weapon/polearm/halberd/behind/walk/halberd.png', twoHanded: true }],
        ['long-spear', 'Long Spear', 'melee', 10, 2.1, 8, 1.1, 150, 'hits', 'weapon/polearm/longspear/foreground/walk/longspear.png', { iconFrameSize: 128, heldFrameSize: 128, heldDisplaySize: 128, heldBackgroundSprite: 'weapon/polearm/longspear/background/walk/longspear.png', twoHanded: true }],
        ['scythe', 'Scythe', 'melee', 11, 1.65, 10, 1.2, 140, 'hits', 'weapon/polearm/scythe/walk/scythe.png', { twoHanded: false }],
        ['spear', 'Spear', 'melee', 8, 1.55, 7, 0.9, 140, 'hits', 'weapon/polearm/spear/foreground/walk/spear.png', { heldBackgroundSprite: 'weapon/polearm/spear/background/walk/spear.png', twoHanded: true }],
        ['trident', 'Trident', 'melee', 9, 1.55, 8, 0.95, 140, 'hits', 'weapon/polearm/trident/foreground/walk/trident.png', { iconFrameSize: 128, heldFrameSize: 128, heldDisplaySize: 128, heldBackgroundSprite: 'weapon/polearm/trident/background/walk/trident.png', twoHanded: true }]
      ]
    },
    {
      name: 'Magic Weapons', items: [
        ['crystal', 'Crystal', 'magic', 6, 6, 0, 0, 120, 'casts', 'weapon/magic/crystal/universal/foreground/walk/crystal.png', { manaCost: 5, castTime: 0.8 }],
        ['diamond-staff', 'Diamond Staff', 'magic', 11, 9, 0, 0, 200, 'casts', 'weapon/magic/diamond/universal/foreground/walk/diamond.png', { heldBackgroundSprite: 'weapon/magic/diamond/universal/background/walk/diamond.png', manaCost: 10, castTime: 1.5, twoHanded: true }],
        ['gnarled-staff', 'Gnarled Staff', 'magic', 9, 8, 0, 0, 150, 'casts', 'weapon/magic/gnarled/universal/foreground/walk/gnarled.png', { heldBackgroundSprite: 'weapon/magic/gnarled/universal/background/walk/gnarled.png', manaCost: 8, castTime: 1.3, twoHanded: true }],
        ['loop-staff', 'Loop Staff', 'magic', 8, 8, 0, 0, 140, 'casts', 'weapon/magic/loop/universal/foreground/walk/loop.png', { heldBackgroundSprite: 'weapon/magic/loop/universal/background/walk/loop.png', manaCost: 7, castTime: 1.2, twoHanded: true }],
        ['s-staff', 'S Staff', 'magic', 10, 8, 0, 0, 160, 'casts', 'weapon/magic/s/universal/foreground/walk/s.png', { heldBackgroundSprite: 'weapon/magic/s/universal/background/walk/s.png', manaCost: 9, castTime: 1.4, twoHanded: true }],
        ['simple-staff', 'Simple Staff', 'magic', 4, 6, 0, 0, 120, 'casts', 'weapon/magic/simple/foreground/walk/simple.png', { manaCost: 4, castTime: 1.0, twoHanded: true }],
        ['wand', 'Wand', 'magic', 6, 7, 0, 0, 120, 'casts', 'weapon/magic/wand/male/slash/wand.png', { heldFrameSize: 64, heldStaticFrame: 0, manaCost: 5, castTime: 0.7 }]
      ]
    },
    {
      name: 'Tools', items: [
        ['rod', 'Fishing Rod', 'tool', 1, 1.1, 2, 0.55, 100, 'uses', 'tools/fishing_rod/fg.png', { iconFrameSize: 128, heldFrameSize: 128, heldStaticFrame: 0, heldBackgroundSprite: 'tools/fishing_rod/bg.png', twoHanded: true }],
        ['axe', 'Axe', 'tool', 6, 1.0, 5, 0.9, 150, 'uses', 'tools/axe/male/walk.png', { twoHanded: false }],
        ['hammer', 'Hammer', 'tool', 7, 0.85, 6, 1.0, 140, 'uses', 'tools/hammer/male/walk.png', { twoHanded: false }],
        ['pickaxe', 'Pickaxe', 'tool', 6, 0.9, 6, 1.0, 150, 'uses', 'tools/pickaxe/male/walk.png', { twoHanded: false }],
        ['hoe', 'Hoe', 'tool', 2, 0.95, 4, 0.8, 120, 'uses', 'tools/hoe/fg/walk.png', { twoHanded: true }],
        ['shovel', 'Shovel', 'tool', 3, 0.95, 4, 0.85, 120, 'uses', 'tools/shovel/fg/walk.png', { twoHanded: true }],
        ['watering-can', 'Watering Can', 'tool', 0, 0, 0, 0, 120, 'uses', 'tools/watering_can/fg/walk.png', { twoHanded: true }],
        ['whip', 'Whip', 'tool', 5, 1.8, 5, 0.75, 100, 'uses', 'tools/whip/fg.png', { iconFrameSize: 192, heldFrameSize: 192, heldStaticFrame: 0, heldBackgroundSprite: 'tools/whip/bg.png' }]
      ]
    }
  ];

  const WEARABLE_SLOTS = [
    { slot: 'head', name: 'Armor - Head', defense: 1, sprite: 'hat/helmet/armet/adult/walk.png', appearanceLayers: [{ z: 130, path: 'hat/helmet/armet/adult/walk.png' }] },
    { slot: 'chest', name: 'Armor - Chest', defense: 3, sprite: 'torso/armour/plate/male/walk.png', appearanceLayers: [{ z: 65, path: 'torso/armour/plate/{gender}/walk.png' }] },
    { slot: 'waist', name: 'Armor - Back', defense: 1, sprite: 'torso/waist/belt_leather/male/walk.png', appearanceLayers: [{ z: 30, path: 'torso/waist/belt_leather/{gender}/walk.png' }] },
    { slot: 'legs', name: 'Armor - Legs', defense: 2, sprite: 'legs/armour/plate/male/walk.png', appearanceLayers: [{ z: 28, path: 'legs/armour/plate/{lowerBodyGender}/walk.png' }] },
    { slot: 'feet', name: 'Armor - Feet', defense: 1, sprite: 'feet/armour/plate/male/walk.png', appearanceLayers: [{ z: 32, path: 'feet/armour/plate/{lowerBodyGender}/walk.png' }] }
  ];

  function makeWearableItem(config) {
    return createItem({
      itemType: 'equipment',
      equipmentClass: 'apparel',
      category: 'Vestimentas',
      ...config
    });
  }

  function buildWearableSections() {
    return WEARABLE_SLOTS.map(slotInfo => {
      const baseItem = makeWearableItem({
        id: `armor-${slotInfo.slot}-base`,
        displayName: `${slotInfo.slot === 'head' ? 'Helmet' : slotInfo.slot === 'chest' ? 'Plate Armor' : slotInfo.slot === 'waist' ? 'Armored Belt' : slotInfo.slot === 'legs' ? 'Greaves' : 'Armored Boots'}`,
        sprite: slotInfo.sprite,
        wearSlot: slotInfo.slot,
        wearCategory: 'armor',
        armorDefense: slotInfo.defense,
        durability: 100,
        durabilityUnit: 'hits',
        appearanceLayers: slotInfo.appearanceLayers
      });
      const items = MATERIAL_ORDER.map(material => {
        const materialStats = MATERIAL_STATS[material];
        const materialColor = MATERIAL_COLORS[material];
        const appearanceLayers = slotInfo.appearanceLayers.map(layer => ({
          ...layer,
          mode: 'tint',
          palette: materialColor.hex
        }));
        if (slotInfo.slot === 'chest') {
          const details = ARMOR_DETAILS[material];
          if (details.sleeves) appearanceLayers.push({
            z: 64,
            path: 'torso/clothes/longsleeve/longsleeves/{gender}/walk.png',
            mode: 'tint',
            palette: materialColor.hex
          });
          if (details.gloves) appearanceLayers.push({
            z: 66,
            path: 'arms/hands/gloves/{armGender}/walk.png',
            mode: 'tint',
            palette: materialColor.hex
          });
        }
        const item = { ...baseItem,
          id: `armor-${slotInfo.slot}-${material}`,
          displayName: `${materialStats.name} ${baseItem.displayName}`,
          material,
          materialName: materialStats.name,
          armorDefense: Math.round(slotInfo.defense * materialStats.armorDefense * 100) / 100,
          speedPenalty: materialStats.armorSpeedPenalty,
          durability: Math.max(1, Math.round(100 * materialStats.armorDurability)),
          maxDurability: Math.max(1, Math.round(100 * materialStats.armorDurability)),
          appearanceLayers,
          collected: false
        };
        baseItem.image.addEventListener('load', () => { item.iconCanvas = baseItem.iconCanvas; }, { once: true });
        return item;
      });
      return { name: slotInfo.name, items };
    }).concat([
      {
        name: 'Cosmetic Apparel',
        items: [
          makeWearableItem({
            id: 'king-crown', displayName: 'Coroa Real', sprite: 'hat/formal/crown/adult/walk.png',
            wearSlot: 'head', wearCategory: 'cosmetic',
            appearanceLayers: [{ z: 130, path: 'hat/formal/crown/adult/walk.png' }],
            isKingCrown: true,
            iconSize: 36
          }),
          makeWearableItem({
            id: 'cosmetic-sack-cloth-hood', displayName: 'Sack Cloth Hood', sprite: 'hat/cloth/hood_sack/adult/walk.png',
            wearSlot: 'head', wearCategory: 'cosmetic',
            appearanceLayers: [{ z: 130, path: 'hat/cloth/hood_sack/adult/walk.png' }]
          }),
          makeWearableItem({
            id: 'cosmetic-cape', displayName: 'Simple Cape', sprite: 'cape/solid/fg/walk.png',
            wearSlot: 'waist', wearCategory: 'cosmetic',
            appearanceLayers: [{ z: 8, path: 'cape/solid/bg/walk.png' }, { z: 126, path: 'cape/solid/fg/walk.png' }]
          }),
          makeWearableItem({
            id: 'cosmetic-linen-shirt', displayName: 'Linen Shirt', sprite: 'torso/clothes/shortsleeve/shortsleeve/male/walk.png',
            wearSlot: 'chest', wearCategory: 'cosmetic',
            appearanceLayers: [{ z: 65, path: 'torso/clothes/shortsleeve/shortsleeve/{gender}/walk.png' }]
          }),
          makeWearableItem({
            id: 'cosmetic-trousers', displayName: 'Dark Trousers', sprite: 'legs/pants2/male/walk.png',
            wearSlot: 'legs', wearCategory: 'cosmetic',
            recolorMode: 'black',
            appearanceLayers: [{ z: 22, path: 'legs/pants2/{lowerBodyGender}/walk.png', mode: 'black' }]
          }),
          makeWearableItem({
            id: 'cosmetic-shoes', displayName: 'Simple Shoes', sprite: 'feet/shoes/basic/male/walk.png',
            wearSlot: 'feet', wearCategory: 'cosmetic',
            recolorMode: 'black',
            appearanceLayers: [{ z: 27, path: 'feet/shoes/basic/{shoeGender}/walk.png', mode: 'black' }]
          }),
          makeWearableItem({
            id: 'cosmetic-leather-belt', displayName: 'Leather Belt', sprite: 'torso/waist/belt_leather/male/walk.png',
            wearSlot: 'waist', wearCategory: 'cosmetic',
            appearanceLayers: [{ z: 30, path: 'torso/waist/belt_leather/{gender}/walk.png' }]
          })
        ]
      }
    ]);
  }

  const longsword = window.KTKWorldSword.entity;
  const itemsBySection = sections.map(section => ({
    name: section.name,
    items: section.items.flatMap(data => {
      const [id, displayName, equipmentClass, attackBonus, range, staminaCost, attackInterval, durability, durabilityUnit, sprite, extra = {}] = data;
      if (extra.existingLongsword) {
        Object.assign(longsword, {
          category: section.name,
          equipmentClass,
          twoHanded: Boolean(extra.twoHanded),
          durabilityUnit,
          iconFrameSize: FRAME_SIZE,
          iconSize: 36,
          displayName
        });
        const iconImage = new Image();
        longsword.iconImage = iconImage;
        iconImage.onload = () => { longsword.iconCanvas = fitIcon(iconImage, FRAME_SIZE); };
        iconImage.onerror = () => console.warn('Sprite de equipamento nao encontrado:', sprite);
        iconImage.src = SPRITE_ROOT + sprite;
        return [longsword];
      }
      const baseConfig = {
        id: `equipment-${id}`,
        displayName,
        category: section.name,
        equipmentClass,
        attackBonus,
        range,
        staminaCost,
        attackInterval,
        durability,
        durabilityUnit,
        sprite,
        ...(ATTACK_ANIMATIONS[id] || {}),
        ...extra
      };
      const materialVariants = MATERIAL_SPRITE_VARIANTS[id];
      if (!materialVariants) return [createItem(baseConfig)];

      return MATERIAL_ORDER.map(material => {
        const materialStats = MATERIAL_STATS[material];
        const attackMultiplier = getMaterialAttackMultiplier(material, materialVariants.attackType);
        const baseWorkEfficiency = Number(baseConfig.workEfficiency)
          || (equipmentClass === 'tool' ? 1 : 0);
        return createItem({
          ...baseConfig,
          ...materialVariants.sprites(material),
          id: `equipment-${id}-${material}`,
          displayName: `${materialStats.name} ${displayName}`,
          material,
          materialName: materialStats.name,
          attackBonus: scaleMaterialStat(attackBonus, attackMultiplier),
          staminaCost: scaleMaterialStat(staminaCost, materialStats.stamina),
          durability: scaleMaterialStat(durability, materialStats.durability),
          workEfficiency: scaleWorkEfficiency(baseWorkEfficiency, materialStats.work),
          materialDamageBonuses: material === 'silver' ? { undead: 1.25 } : {}
        });
      });
    })
  }));

  itemsBySection.push(...buildWearableSections());

  const items = itemsBySection.flatMap(section => section.items);

  let kingCrownSpawned = false;
  function buildMapWearableDrops() {
    if (kingCrownSpawned) return [];
    const crown = items.find(item => item.isKingCrown);
    if (!crown) return [];
    kingCrownSpawned = true;
    crown.collected = false;
    crown.x = 0;
    crown.y = 0;
    return [crown];
  }

  function arrangeFirstMap(width, height, mapItems = []) {
    const safeWidth = Math.max(320, Number(width) || 1280);
    const safeHeight = Math.max(320, Number(height) || 720);
    const columns = Math.min(5, Math.max(1, mapItems.length));
    const totalRows = Math.ceil(mapItems.length / columns);
    const xSpacing = Math.max(128, safeWidth * 0.18);
    const ySpacing = Math.max(112, safeHeight * 0.18);
    mapItems.forEach((item, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      item.x = item.isKingCrown ? 0 : (column - (columns - 1) / 2) * xSpacing + (Math.random() - 0.5) * 18;
      item.y = item.isKingCrown ? 0 : (row - (totalRows - 1) / 2) * ySpacing + (Math.random() - 0.5) * 18;
      item.catalogSection = item.category || 'Vestimentas';
      item.catalogOrder = index;
      item.iconSize = item.isKingCrown ? 48 : 36;
      item.displaySize = item.iconSize;
    });
  }

  window.KTKEquipmentCatalog = { items, sections: itemsBySection, arrangeFirstMap, buildMapWearableDrops, materialStats: MATERIAL_STATS, wearableSlots: WEARABLE_SLOTS.map(({ slot, defense }) => ({ slot, defense })) };
})();
