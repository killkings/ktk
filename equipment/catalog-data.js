/* Configuração visual LPC. Não contém atributos de combate, custos ou durabilidade. */
(function () {
  'use strict';
  window.KTKEquipmentModules = window.KTKEquipmentModules || {};
  const SPRITE_ROOT = window.KTKLPC_CONFIG?.spritesRoot;
  if (!SPRITE_ROOT) throw new Error('A configuração central do LPC não foi carregada.');
  const FRAME_SIZE = 64;
  const MATERIAL_ORDER = [
  "brass",
  "bronze",
  "ceramic",
  "copper",
  "gold",
  "iron",
  "silver",
  "steel"
];
  const MATERIAL_COLORS = {
  "brass": {
    "name": "Brass",
    "hex": "#c5a64d"
  },
  "bronze": {
    "name": "Bronze",
    "hex": "#a96b42"
  },
  "ceramic": {
    "name": "Ceramic",
    "hex": "#d6d0c2"
  },
  "copper": {
    "name": "Copper",
    "hex": "#b87345"
  },
  "gold": {
    "name": "Gold",
    "hex": "#e2bd4f"
  },
  "iron": {
    "name": "Iron",
    "hex": "#737a80"
  },
  "silver": {
    "name": "Silver",
    "hex": "#c2cbd2"
  },
  "steel": {
    "name": "Steel",
    "hex": "#8293a1"
  }
};
  const ARMOR_DETAILS = {
  "brass": {
    "sleeves": true
  },
  "bronze": {
    "sleeves": true,
    "gloves": true
  },
  "ceramic": {
    "gloves": true
  },
  "copper": {
    "sleeves": true,
    "gloves": true
  },
  "gold": {},
  "iron": {
    "sleeves": true
  },
  "silver": {
    "gloves": true
  },
  "steel": {
    "sleeves": true,
    "gloves": true
  }
};
  const MATERIAL_SPRITE_VARIANTS = {
    'arming-sword': {

      sprites: material => ({
        sprite: `weapon/sword/arming/universal/fg/walk/${material}.png`,
        heldBackgroundSprite: `weapon/sword/arming/universal/bg/walk/${material}.png`,
        attackSprite: `weapon/sword/arming/attack_halfslash/fg/${material}.png`,
        attackBackgroundSprite: `weapon/sword/arming/attack_halfslash/bg/${material}.png`,
        iconSprite: null
      })
    },
    'bow-normal': {

      sprites: material => ({
        sprite: `weapon/ranged/bow/normal/walk/foreground/${material}.png`,
        heldBackgroundSprite: `weapon/ranged/bow/normal/walk/background/${material}.png`,
        attackSprite: `weapon/ranged/bow/normal/universal/foreground/shoot/${material}.png`,
        attackBackgroundSprite: `weapon/ranged/bow/normal/universal/background/shoot/${material}.png`,
        iconSprite: `weapon/ranged/bow/normal/universal/foreground/shoot/${material}.png`
      })
    },
    'bow-great': {

      sprites: material => ({
        sprite: `weapon/ranged/bow/great/walk/foreground/${material}.png`,
        heldBackgroundSprite: `weapon/ranged/bow/great/walk/background/${material}.png`,
        attackSprite: `weapon/ranged/bow/great/universal/foreground/shoot/${material}.png`,
        iconSprite: `weapon/ranged/bow/great/universal/foreground/shoot/${material}.png`
      })
    },
    'bow-recurve': {

      sprites: material => ({
        sprite: `weapon/ranged/bow/recurve/walk/foreground/${material}.png`,
        heldBackgroundSprite: `weapon/ranged/bow/recurve/walk/background/${material}.png`,
        attackSprite: `weapon/ranged/bow/recurve/universal/foreground/shoot/${material}.png`,
        attackBackgroundSprite: `weapon/ranged/bow/recurve/universal/background/shoot/${material}.png`,
        iconSprite: `weapon/ranged/bow/recurve/universal/foreground/shoot/${material}.png`
      })
    },
    'dragon-spear': {

      sprites: material => ({
        sprite: `weapon/polearm/dragonspear/foreground/walk/${material}.png`,
        heldBackgroundSprite: `weapon/polearm/dragonspear/background/walk/${material}.png`,
        attackSprite: `weapon/polearm/dragonspear/foreground/thrust/${material}.png`,
        attackBackgroundSprite: `weapon/polearm/dragonspear/background/thrust/${material}.png`,
        iconSprite: null
      })
    },
    'long-spear': {

      sprites: material => ({
        sprite: `weapon/polearm/longspear/foreground/walk/${material}.png`,
        heldBackgroundSprite: `weapon/polearm/longspear/background/walk/${material}.png`,
        attackSprite: `weapon/polearm/longspear/foreground/thrust/${material}.png`,
        attackBackgroundSprite: `weapon/polearm/longspear/background/thrust/${material}.png`,
        iconSprite: null
      })
    },
    spear: {

      sprites: material => ({
        sprite: `weapon/polearm/spear/foreground/walk/${material}.png`,
        heldBackgroundSprite: `weapon/polearm/spear/background/walk/${material}.png`,
        attackSprite: `weapon/polearm/spear/foreground/thrust/${material}.png`,
        attackBackgroundSprite: `weapon/polearm/spear/background/thrust/${material}.png`,
        iconSprite: null
      })
    },
    trident: {

      sprites: material => ({
        sprite: `weapon/polearm/trident/foreground/walk/${material}.png`,
        heldBackgroundSprite: `weapon/polearm/trident/background/walk/${material}.png`,
        attackSprite: `weapon/polearm/trident/foreground/thrust/${material}.png`,
        attackBackgroundSprite: `weapon/polearm/trident/background/thrust/${material}.png`,
        iconSprite: null
      })
    },
    'diamond-staff': {

      sprites: material => ({
        sprite: `weapon/magic/diamond/universal/foreground/walk/${material}.png`,
        heldBackgroundSprite: `weapon/magic/diamond/universal/background/walk/${material}.png`,
        attackSprite: `weapon/magic/diamond/thrust/foreground/${material}.png`,
        attackBackgroundSprite: `weapon/magic/diamond/thrust/background/${material}.png`,
        iconSprite: null
      })
    },
    'gnarled-staff': {

      sprites: material => ({
        sprite: `weapon/magic/gnarled/universal/foreground/walk/${material}.png`,
        heldBackgroundSprite: `weapon/magic/gnarled/universal/background/walk/${material}.png`,
        attackSprite: `weapon/magic/gnarled/thrust/foreground/${material}.png`,
        attackBackgroundSprite: `weapon/magic/gnarled/thrust/background/${material}.png`,
        iconSprite: null
      })
    },
    'loop-staff': {

      sprites: material => ({
        sprite: `weapon/magic/loop/universal/foreground/walk/${material}.png`,
        heldBackgroundSprite: `weapon/magic/loop/universal/background/walk/${material}.png`,
        attackSprite: `weapon/magic/loop/thrust/foreground/${material}.png`,
        attackBackgroundSprite: `weapon/magic/loop/thrust/background/${material}.png`,
        iconSprite: null
      })
    },
    's-staff': {

      sprites: material => ({
        sprite: `weapon/magic/s/universal/foreground/walk/${material}.png`,
        heldBackgroundSprite: `weapon/magic/s/universal/background/walk/${material}.png`,
        attackSprite: `weapon/magic/s/thrust/foreground/${material}.png`,
        attackBackgroundSprite: `weapon/magic/s/thrust/background/${material}.png`,
        iconSprite: null
      })
    }
  };
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
  const SECTIONS = [
  {
    "name": "Shields",
    "items": [
      {
        "id": "two-engrailed-shield",
        "displayName": "Two-Engrailed Shield",
        "equipmentClass": "shield",
        "sprite": "shield/two_engrailed/fg/male/walk/two_engrailed.png",
        "visual": {}
      },
      {
        "id": "scutum-shield",
        "displayName": "Scutum Shield",
        "equipmentClass": "shield",
        "sprite": "shield/scutum/paint/fg/male/walk/scutum.png",
        "visual": {}
      },
      {
        "id": "heater-shield",
        "displayName": "Heater Shield",
        "equipmentClass": "shield",
        "sprite": "shield/heater/original/paint/fg/walk.png",
        "visual": {}
      },
      {
        "id": "round-shield",
        "displayName": "Round Shield",
        "equipmentClass": "shield",
        "sprite": "shield/round/walk/brown.png",
        "visual": {}
      },
      {
        "id": "kite-shield",
        "displayName": "Kite",
        "equipmentClass": "shield",
        "sprite": "shield/kite/female/walk/kite_gray.png",
        "visual": {}
      },
      {
        "id": "spartan-shield",
        "displayName": "Spartan Shield",
        "equipmentClass": "shield",
        "sprite": "shield/spartan/fg/walk/spartan.png",
        "visual": {}
      }
    ]
  },
  {
    "name": "Ranged Weapons",
    "items": [
      {
        "id": "bow-normal",
        "displayName": "Bow - Normal",
        "equipmentClass": "ranged",
        "sprite": "weapon/ranged/bow/normal/walk/foreground.png",
        "visual": {
          "iconSprite": "weapon/ranged/bow/normal/universal/foreground/shoot/normal.png",
          "iconStaticFrame": 12,
          "iconStaticRow": 1,
          "iconFrameSize": 64,
          "iconSize": 64,
          "iconFillSize": 60,
          "heldBackgroundSprite": "weapon/ranged/bow/normal/universal/background/hurt/normal.png",
          "heldBackgroundStaticFrame": 5
        }
      },
      {
        "id": "bow-great",
        "displayName": "Bow - Great",
        "equipmentClass": "ranged",
        "sprite": "weapon/ranged/bow/great/walk/foreground/great.png",
        "visual": {
          "iconSprite": "weapon/ranged/bow/great/universal/foreground/shoot/great.png",
          "iconStaticFrame": 12,
          "iconStaticRow": 1,
          "iconFrameSize": 64,
          "iconSize": 64,
          "iconFillSize": 60,
          "heldBackgroundSprite": "weapon/ranged/bow/great/universal/background/hurt/great.png",
          "heldBackgroundStaticFrame": 5
        }
      },
      {
        "id": "bow-recurve",
        "displayName": "Bow - Recurve",
        "equipmentClass": "ranged",
        "sprite": "weapon/ranged/bow/recurve/walk/foreground/recurve.png",
        "visual": {
          "iconSprite": "weapon/ranged/bow/recurve/universal/foreground/shoot/recurve.png",
          "iconStaticFrame": 12,
          "iconStaticRow": 1,
          "iconFrameSize": 64,
          "iconSize": 64,
          "iconFillSize": 60,
          "heldBackgroundSprite": "weapon/ranged/bow/recurve/universal/background/hurt/recurve.png",
          "heldBackgroundStaticFrame": 5
        }
      },
      {
        "id": "crossbow",
        "displayName": "Crossbow",
        "equipmentClass": "ranged",
        "sprite": "weapon/ranged/crossbow/foreground/walk/crossbow.png",
        "visual": {}
      },
      {
        "id": "slingshot",
        "displayName": "Slingshot",
        "equipmentClass": "ranged",
        "sprite": "weapon/ranged/slingshot/foreground/walk/slingshot.png",
        "visual": {}
      },
      {
        "id": "boomerang",
        "displayName": "Boomerang",
        "equipmentClass": "ranged",
        "sprite": "weapon/ranged/boomerang/boomerang.png",
        "visual": {
          "iconFrameSize": 192,
          "heldDisplaySize": 64,
          "heldFrameSize": 192,
          "heldStaticFrame": 0,
          "equipmentZ": 80,
          "attackEquipmentZ": 150
        }
      },
      {
        "id": "arrow",
        "displayName": "Arrow",
        "equipmentClass": "ammunition",
        "sprite": "weapon/ranged/bow/arrow/shoot/arrow.png",
        "visual": {}
      }
    ]
  },
  {
    "name": "Swords",
    "items": [
      {
        "id": "arming-sword",
        "displayName": "Arming Sword",
        "equipmentClass": "melee",
        "sprite": "weapon/sword/arming/universal/walk/fg.png",
        "visual": {
          "heldBackgroundSprite": "weapon/sword/arming/universal/walk/bg.png"
        }
      },
      {
        "id": "dagger",
        "displayName": "Dagger",
        "equipmentClass": "melee",
        "sprite": "weapon/sword/dagger/walk/dagger.png",
        "visual": {}
      },
      {
        "id": "glowsword",
        "displayName": "Glowsword",
        "equipmentClass": "melee",
        "sprite": "weapon/sword/glowsword/walk/red.png",
        "visual": {}
      },
      {
        "id": "katana",
        "displayName": "Katana",
        "equipmentClass": "melee",
        "sprite": "weapon/sword/katana/walk/katana.png",
        "visual": {
          "iconFrameSize": 128,
          "heldBackgroundSprite": "weapon/sword/katana/walk/behind/katana.png",
          "heldFrameSize": 128
        }
      },
      {
        "id": "longsword",
        "displayName": "Longsword",
        "equipmentClass": "melee",
        "sprite": "weapon/sword/longsword/universal_behind/walk/longsword.png",
        "visual": {
          "existingLongsword": true
        }
      },
      {
        "id": "rapier",
        "displayName": "Rapier",
        "equipmentClass": "melee",
        "sprite": "weapon/sword/rapier/walk/rapier.png",
        "visual": {
          "heldBackgroundSprite": "weapon/sword/rapier/universal_behind/walk/rapier.png"
        }
      },
      {
        "id": "saber",
        "displayName": "Saber",
        "equipmentClass": "melee",
        "sprite": "weapon/sword/saber/walk/saber.png",
        "visual": {
          "heldBackgroundSprite": "weapon/sword/saber/universal_behind/walk/saber.png"
        }
      },
      {
        "id": "scimitar",
        "displayName": "Scimitar",
        "equipmentClass": "melee",
        "sprite": "weapon/sword/scimitar/walk/scimitar.png",
        "visual": {
          "iconFrameSize": 128,
          "heldBackgroundSprite": "weapon/sword/scimitar/walk/behind/scimitar.png",
          "heldFrameSize": 128
        }
      }
    ]
  },
  {
    "name": "Blunt Weapons",
    "items": [
      {
        "id": "club",
        "displayName": "Club",
        "equipmentClass": "melee",
        "sprite": "weapon/blunt/club/club.png",
        "visual": {
          "iconFrameSize": 192,
          "heldBackgroundSprite": "weapon/blunt/club/background/club.png",
          "heldDisplaySize": 64,
          "heldFrameSize": 192,
          "heldStaticFrame": 0,
          "equipmentZ": 80,
          "attackEquipmentZ": 140
        }
      },
      {
        "id": "flail",
        "displayName": "Flail",
        "equipmentClass": "melee",
        "sprite": "weapon/blunt/flail/walk/flail.png",
        "visual": {
          "heldBackgroundSprite": "weapon/blunt/flail/behind/walk/flail.png"
        }
      },
      {
        "id": "mace",
        "displayName": "Mace",
        "equipmentClass": "melee",
        "sprite": "weapon/blunt/mace/walk/mace.png",
        "visual": {
          "heldBackgroundSprite": "weapon/blunt/mace/universal_behind/walk/mace.png"
        }
      },
      {
        "id": "waraxe",
        "displayName": "Waraxe",
        "equipmentClass": "melee",
        "sprite": "weapon/blunt/waraxe/walk/waraxe.png",
        "visual": {
          "heldBackgroundSprite": "weapon/blunt/waraxe/behind/walk/waraxe.png"
        }
      }
    ]
  },
  {
    "name": "Polearms",
    "items": [
      {
        "id": "cane",
        "displayName": "Cane",
        "equipmentClass": "melee",
        "sprite": "weapon/polearm/cane/male/walk/cane.png",
        "visual": {}
      },
      {
        "id": "dragon-spear",
        "displayName": "Dragon Spear",
        "equipmentClass": "melee",
        "sprite": "weapon/polearm/dragonspear/foreground/walk/dragonspear.png",
        "visual": {
          "iconFrameSize": 128,
          "heldBackgroundSprite": "weapon/polearm/dragonspear/background/walk/dragonspear.png",
          "heldDisplaySize": 128,
          "heldFrameSize": 128
        }
      },
      {
        "id": "halberd",
        "displayName": "Halberd",
        "equipmentClass": "melee",
        "sprite": "weapon/polearm/halberd/walk/halberd.png",
        "visual": {
          "heldBackgroundSprite": "weapon/polearm/halberd/behind/walk/halberd.png"
        }
      },
      {
        "id": "long-spear",
        "displayName": "Long Spear",
        "equipmentClass": "melee",
        "sprite": "weapon/polearm/longspear/foreground/walk/longspear.png",
        "visual": {
          "iconFrameSize": 128,
          "heldBackgroundSprite": "weapon/polearm/longspear/background/walk/longspear.png",
          "heldDisplaySize": 128,
          "heldFrameSize": 128
        }
      },
      {
        "id": "scythe",
        "displayName": "Scythe",
        "equipmentClass": "melee",
        "sprite": "weapon/polearm/scythe/walk/scythe.png",
        "visual": {}
      },
      {
        "id": "spear",
        "displayName": "Spear",
        "equipmentClass": "melee",
        "sprite": "weapon/polearm/spear/foreground/walk/spear.png",
        "visual": {
          "heldBackgroundSprite": "weapon/polearm/spear/background/walk/spear.png"
        }
      },
      {
        "id": "trident",
        "displayName": "Trident",
        "equipmentClass": "melee",
        "sprite": "weapon/polearm/trident/foreground/walk/trident.png",
        "visual": {
          "iconFrameSize": 128,
          "heldBackgroundSprite": "weapon/polearm/trident/background/walk/trident.png",
          "heldDisplaySize": 128,
          "heldFrameSize": 128
        }
      }
    ]
  },
  {
    "name": "Magic Weapons",
    "items": [
      {
        "id": "crystal",
        "displayName": "Crystal",
        "equipmentClass": "magic",
        "sprite": "weapon/magic/crystal/universal/foreground/walk/crystal.png",
        "visual": {}
      },
      {
        "id": "diamond-staff",
        "displayName": "Diamond Staff",
        "equipmentClass": "magic",
        "sprite": "weapon/magic/diamond/universal/foreground/walk/diamond.png",
        "visual": {
          "heldBackgroundSprite": "weapon/magic/diamond/universal/background/walk/diamond.png"
        }
      },
      {
        "id": "gnarled-staff",
        "displayName": "Gnarled Staff",
        "equipmentClass": "magic",
        "sprite": "weapon/magic/gnarled/universal/foreground/walk/gnarled.png",
        "visual": {
          "heldBackgroundSprite": "weapon/magic/gnarled/universal/background/walk/gnarled.png"
        }
      },
      {
        "id": "loop-staff",
        "displayName": "Loop Staff",
        "equipmentClass": "magic",
        "sprite": "weapon/magic/loop/universal/foreground/walk/loop.png",
        "visual": {
          "heldBackgroundSprite": "weapon/magic/loop/universal/background/walk/loop.png"
        }
      },
      {
        "id": "s-staff",
        "displayName": "S Staff",
        "equipmentClass": "magic",
        "sprite": "weapon/magic/s/universal/foreground/walk/s.png",
        "visual": {
          "heldBackgroundSprite": "weapon/magic/s/universal/background/walk/s.png"
        }
      },
      {
        "id": "simple-staff",
        "displayName": "Simple Staff",
        "equipmentClass": "magic",
        "sprite": "weapon/magic/simple/foreground/walk/simple.png",
        "visual": {}
      },
      {
        "id": "wand",
        "displayName": "Wand",
        "equipmentClass": "magic",
        "sprite": "weapon/magic/wand/male/slash/wand.png",
        "visual": {
          "heldFrameSize": 64,
          "heldStaticFrame": 0
        }
      }
    ]
  },
  {
    "name": "Tools",
    "items": [
      {
        "id": "rod",
        "displayName": "Fishing Rod",
        "equipmentClass": "tool",
        "sprite": "tools/fishing_rod/fg.png",
        "visual": {
          "iconFrameSize": 128,
          "heldBackgroundSprite": "tools/fishing_rod/bg.png",
          "heldFrameSize": 128,
          "heldStaticFrame": 0
        }
      },
      {
        "id": "axe",
        "displayName": "Axe",
        "equipmentClass": "tool",
        "sprite": "tools/axe/male/walk.png",
        "visual": {}
      },
      {
        "id": "hammer",
        "displayName": "Hammer",
        "equipmentClass": "tool",
        "sprite": "tools/hammer/male/walk.png",
        "visual": {}
      },
      {
        "id": "pickaxe",
        "displayName": "Pickaxe",
        "equipmentClass": "tool",
        "sprite": "tools/pickaxe/male/walk.png",
        "visual": {}
      },
      {
        "id": "hoe",
        "displayName": "Hoe",
        "equipmentClass": "tool",
        "sprite": "tools/hoe/fg/walk.png",
        "visual": {}
      },
      {
        "id": "shovel",
        "displayName": "Shovel",
        "equipmentClass": "tool",
        "sprite": "tools/shovel/fg/walk.png",
        "visual": {}
      },
      {
        "id": "watering-can",
        "displayName": "Watering Can",
        "equipmentClass": "tool",
        "sprite": "tools/watering_can/fg/walk.png",
        "visual": {}
      },
      {
        "id": "whip",
        "displayName": "Whip",
        "equipmentClass": "tool",
        "sprite": "tools/whip/fg.png",
        "visual": {
          "iconFrameSize": 192,
          "heldBackgroundSprite": "tools/whip/bg.png",
          "heldFrameSize": 192,
          "heldStaticFrame": 0
        }
      }
    ]
  }
];
  window.KTKEquipmentModules.data = {SPRITE_ROOT,FRAME_SIZE,MATERIAL_ORDER,MATERIAL_COLORS,ARMOR_DETAILS,MATERIAL_SPRITE_VARIANTS,ATTACK_ANIMATIONS,SECTIONS};
})();
