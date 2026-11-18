/*
 * Kill the King — Gerador de mapas em salas 16:9
 * Cada sala ocupa uma tela. A câmera aponta para a coordenada da sala atual.
 * Os Campos Centrais usam o terreno de verão LPC e flores do pacote ElizaWy;
 * o terreno procedural funciona apenas como fallback se um asset falhar.
 */
(() => {
  'use strict';

  const TILE = 32;
  let viewWidth = 1920;
  let viewHeight = 1080;
  const assetRoot = './mapa/assets/';
  const assetSources = {
    'terrain_summer.png': './mapa/assets/lpc-terrain-summer.png',
    'wildflowers_summer.png': 'https://raw.githubusercontent.com/ElizaWy/LPC/f07f7f5892e67c932c68f70bb04472f2c64e46bc/Terrain/wildflowers_summer.png',
    'plants_summer.png': './mapa/assets/lpc-plants-summer.png'
  };
  const tileCache = new Map();
  const decorationCache = new Map();
  const roomCanvasCache = new Map();
  const assets = new Map();
  const assetStatus = new Map();

  const biomes = [
    {
      id: 'campos', name: 'Campos Centrais', base: '#719b50', detail: '#91ad60', accent: '#d4cc79',
      resource: 'Ervas, flores e madeira', season: 'summer',
      variants: ['Pradaria do Centro', 'Bosque das Lebres', 'Riachos Claros', 'Campos Floridos', 'Lago das Garças', 'Clareiras', 'Bosque Antigo', 'Ruínas Cobertas']
    },
    {
      id: 'floresta', name: 'Florestas Temperadas', base: '#527947', detail: '#739157', accent: '#c0b766',
      resource: 'Madeira, cogumelos e caça', season: 'spring',
      variants: ['Mata Densa', 'Clareiras do Leste', 'Riachos Sombreados', 'Lagos de Carvalho', 'Bosques', 'Grutas Musgosas', 'Árvores Ancestrais', 'Ruínas da Mata']
    },
    {
      id: 'pantano', name: 'Pântanos', base: '#596f50', detail: '#77815a', accent: '#9a9a62',
      resource: 'Ervas medicinais, turfa e venenos', season: 'summer',
      variants: ['Brejo Fundo', 'Lamaçais', 'Águas Rasas', 'Árvores Retorcidas', 'Juncais', 'Lagoas Escuras', 'Ervas Raras', 'Ruínas Alagadas']
    },
    {
      id: 'terras-altas', name: 'Terras Altas', base: '#8a805e', detail: '#aaa078', accent: '#626555',
      resource: 'Pedra, ferro e cavernas', season: 'autumn',
      variants: ['Campos Rochosos', 'Planícies Pedregosas', 'Bosques Ralos', 'Cavernas', 'Vales Minerais', 'Campos Ventosos', 'Riachos Rasos', 'Minas Antigas']
    },
    {
      id: 'deserto', name: 'Desertos', base: '#c29c5d', detail: '#d5b773', accent: '#e4ce8c',
      resource: 'Cactos, cobre e minerais raros', season: 'summer',
      variants: ['Areias Claras', 'Deserto Rochoso', 'Oásis', 'Campos Secos', 'Campos de Cactos', 'Areias Vermelhas', 'Salinas', 'Ruínas Soterradas']
    },
    {
      id: 'savana', name: 'Savanas', base: '#a49a4f', detail: '#c0ad60', accent: '#7d8951',
      resource: 'Fibras, frutos e caça', season: 'autumn',
      variants: ['Capim Alto', 'Árvores Espaçadas', 'Rios Sazonais', 'Campos Dourados', 'Bosques de Acácias', 'Planícies Quentes', 'Charcos da Savana', 'Pedras Antigas']
    },
    {
      id: 'selva', name: 'Selvas Tropicais', base: '#39734d', detail: '#548b50', accent: '#b1ba54',
      resource: 'Frutas exóticas, cipós e plantas raras', season: 'summer',
      variants: ['Selva Densa', 'Árvores Gigantes', 'Cipós', 'Clareiras Úmidas', 'Rios Tropicais', 'Jardins Selvagens', 'Ruínas Verdes', 'Bosques de Frutas']
    },
    {
      id: 'taiga', name: 'Taiga', base: '#587866', detail: '#789078', accent: '#aab58a',
      resource: 'Madeira resistente, resina e peles', season: 'winter',
      variants: ['Pinheiral Fechado', 'Lagos Frios', 'Bosque de Bétulas', 'Clareiras Nevadas', 'Brejo Gelado', 'Vale dos Alces', 'Clareira Boreal', 'Cabana Abandonada']
    },
    {
      id: 'congeladas', name: 'Terras Congeladas', base: '#a8c3c4', detail: '#d2e1da', accent: '#70989e',
      resource: 'Gelo, cristais e minerais raros', season: 'winter_ice',
      variants: ['Campos de Neve', 'Gelo Raso', 'Lagos Congelados', 'Cavernas de Gelo', 'Planícies Brancas', 'Geada', 'Fendas Azuis', 'Ruínas Congeladas']
    },
    {
      id: 'aguas-quentes', name: 'Águas Quentes', base: '#397f91', detail: '#55a3a5', accent: '#b5d18a',
      resource: 'Peixes, algas e conchas', season: null,
      variants: ['Canais Quentes', 'Ilhas Tropicais', 'Praias Rasas', 'Passagem das Pontes', 'Lagoas Claras', 'Arquipélago', 'Costa das Fontes', 'Estreito Verde']
    },
    {
      id: 'oceano-polar', name: 'Oceano Polar', base: '#263f59', detail: '#456781', accent: '#a8d1d6',
      resource: 'Gelo marinho e pesca', season: null,
      variants: ['Águas Abertas', 'Blocos de Gelo', 'Icebergs', 'Ilhas Congeladas']
    }
  ];
  // O mapa atual permanece no centro. Os oito territórios vizinhos começam
  // vazios, mas têm exatamente as mesmas dimensões e conexões de uma sala.
  const centralBiome = biomes.find(biome => biome.id === 'campos');
  if (centralBiome) centralBiome.variants = ['Pradaria do Centro'];
  const emptyBiome = {
    id: 'vazio', name: 'Campos Abertos', base: '#719b50', detail: '#719b50', accent: '#719b50',
    resource: 'Nenhum', season: 'summer', variants: ['Terreno vazio']
  };
  biomes.splice(0, biomes.length, ...(centralBiome ? [centralBiome, emptyBiome] : [emptyBiome]));
  const biomeById = new Map(biomes.map(biome => [biome.id, biome]));
  const biomeOrder = new Map(biomes.map((biome, index) => [biome.id, index]));

  // Mapa padrão permanente do KTK: nove áreas de campo em uma grade 3×3.
  // A sala central é a área inicial; as oito salas externas preservam a grama CSS
  // própria de cada posição e permanecem abertas para futuras expansões.
  const DEFAULT_MAP = Object.freeze({
    id: 'campos-centrais-3x3',
    name: 'Campos Centrais',
    grassStyle: 'css-nine-variants',
    layout: Object.freeze([
      Object.freeze(['vazio', 'vazio', 'vazio']),
      Object.freeze(['vazio', 'campos', 'vazio']),
      Object.freeze(['vazio', 'vazio', 'vazio'])
    ])
  });
  const layout = DEFAULT_MAP.layout.map(row => row.slice());
  const GRID_CENTER = 1;

  function getRoomLimits() {
    return { minX: -GRID_CENTER, maxX: layout[0].length-1-GRID_CENTER,
      minY: -GRID_CENTER, maxY: layout.length-1-GRID_CENTER };
  }

  // Coordenada da sala é calculada em relação ao tamanho atual da viewport.
  function roomAt(x, y) {
    const col = Math.max(0, Math.min(layout[0].length - 1, Math.floor(x / viewWidth + 0.5) + GRID_CENTER));
    const row = Math.max(0, Math.min(layout.length - 1, Math.floor(y / viewHeight + 0.5) + GRID_CENTER));
    const id = layout[row]?.[col] || 'campos';
    return { col, row, id, biome: biomeById.get(id) || biomeById.get('campos') };
  }

  function getBiomeAt(x, y) {
    return roomAt(x, y).biome;
  }

  function random01(x, y, salt = 0) {
    let n = Math.imul((x | 0) ^ Math.imul((y | 0) + salt * 1013, 0x045d9f3b), 0x27d4eb2d);
    n = Math.imul(n ^ (n >>> 15), 0x85ebca6b);
    n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  }

  function regionAt(x, y) {
    const room = roomAt(x, y);
    const biome = room.biome;
    const order = biomeOrder.get(biome.id) ?? 0;
    const variationIndex = Math.floor(random01(room.col, room.row, order + 17) * biome.variants.length);
    const tileX = Math.floor(x / TILE);
    const tileY = Math.floor(y / TILE);
    const resourceChance = random01(tileX, tileY, order);
    return {
      id: biome.id,
      name: biome.name,
      ring: order,
      x: room.col + 1,
      y: room.row + 1,
      subregion: biome.variants[variationIndex],
      resources: biome.resource,
      resource: resourceChance > 0.975 ? biome.resource : null,
      biome
    };
  }

  function loadAsset(file) {
    if (assets.has(file)) return;
    const image = new Image();
    image.onload = () => {
      assetStatus.set(file, 'loaded');
      tileCache.clear();
      roomCanvasCache.clear();
    };
    image.onerror = () => {
      assetStatus.set(file, 'missing');
      // Falta de arquivo LPC não impede a renderização: o terreno procedural é o fallback.
    };
    image.src = assetSources[file] || (assetRoot + file);
    assets.set(file, image);
  }

  ['terrain_summer.png', 'wildflowers_summer.png', 'plants_summer.png'].forEach(loadAsset);

  function setViewport(width, height) {
    const safeWidth = Math.max(1, Number(width) || 1920);
    const safeHeight = Math.max(1, Number(height) || 1080);
    if (viewWidth !== safeWidth || viewHeight !== safeHeight) {
      viewWidth = safeWidth;
      viewHeight = safeHeight;
      tileCache.clear();
      decorationCache.clear();
      roomCanvasCache.clear();
    }
  }

  function drawWaterTile(g, tx, ty, biome, seed) {
    const warm = biome.id === 'aguas-quentes';
    g.fillStyle = biome.base;
    g.fillRect(0, 0, TILE, TILE);

    // Faixas suaves de correnteza, determinadas pela coordenada global do tile.
    g.strokeStyle = warm ? 'rgba(151,220,205,.30)' : 'rgba(164,207,224,.25)';
    g.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const y = 5 + i * 11 + random01(tx, ty, 20 + i) * 4;
      const x = random01(tx, ty, 30 + i) * 10;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + 7, y - 2, x + 14, y);
      g.quadraticCurveTo(x + 21, y + 2, x + 29, y - 1);
      g.stroke();
    }

    if (warm && seed > 0.86) {
      g.fillStyle = 'rgba(224,211,151,.70)';
      g.fillRect(0, 0, TILE, 3);
      g.fillRect(0, TILE - 3, TILE, 3);
    }

    if (!warm && seed > 0.34) {
      const x = 3 + random01(tx, ty, 44) * 18;
      const y = 3 + random01(tx, ty, 45) * 18;
      const w = 6 + random01(tx, ty, 46) * 8;
      const h = 4 + random01(tx, ty, 47) * 7;
      g.fillStyle = 'rgba(196,224,230,.82)';
      g.beginPath();
      g.ellipse(x, y, w, h, seed * 2, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(239,247,239,.72)';
      g.fillRect(x - 2, y - 1, 4, 2);
    }
  }

  function drawGroundTile(g, tx, ty, region) {
    const biome = region.biome;
    const seed = random01(tx, ty, region.ring + 1);
    g.imageSmoothingEnabled = false;

    // O chão dos nove mapas fica transparente para revelar a grama CSS do #world.
    // Elementos de jogo e decorações continuam renderizados em primeiro plano.
    if (biome.id === 'campos' || biome.id === 'vazio') return;

    if (biome.id === 'aguas-quentes' || biome.id === 'oceano-polar') {
      drawWaterTile(g, tx, ty, biome, seed);
      return;
    }

    const season = biome.season || 'summer';
    const terrain = assets.get('terrain_' + season + '.png');
    const source = {
      campos: [96, 32], floresta: [96, 32], pantano: [96, 32],
      'terras-altas': [96, 64], deserto: [96, 160], savana: [96, 32],
      selva: [96, 32], taiga: [96, 32], congeladas: [96, 32]
    }[biome.id] || [96, 32];

    const canUseAsset = terrain && terrain.complete && terrain.naturalWidth >= source[0] + 16 && terrain.naturalHeight >= source[1] + 16;
    if (canUseAsset) {
      g.drawImage(terrain, source[0], source[1], 16, 16, 0, 0, TILE, TILE);
      // Tinta leve mantém a identidade cromática de cada bioma.
      g.fillStyle = biome.base;
      g.globalAlpha = 0.22;
      g.fillRect(0, 0, TILE, TILE);
      g.globalAlpha = 1;
    } else {
      g.fillStyle = biome.base;
      g.fillRect(0, 0, TILE, TILE);
      g.fillStyle = biome.detail;
      g.globalAlpha = 0.12 + seed * 0.08;
      g.fillRect(0, 0, TILE, TILE);
      g.globalAlpha = 1;
    }

    // Textura básica por bioma. Nada aqui depende dos arquivos LPC.
    if (biome.id === 'campos' || biome.id === 'floresta' || biome.id === 'savana' || biome.id === 'selva') {
      const blades = biome.id === 'selva' ? 13 : biome.id === 'floresta' ? 10 : 8;
      g.strokeStyle = biome.detail;
      g.globalAlpha = 0.44;
      g.lineWidth = 1;
      for (let i = 0; i < blades; i++) {
        const x = 3 + random01(tx * 13 + i, ty * 17 - i, 2) * (TILE - 6);
        const y = 3 + random01(tx * 19 - i, ty * 11 + i, 3) * (TILE - 6);
        g.beginPath();
        g.moveTo(x, y + 3);
        g.quadraticCurveTo(x - 2, y, x + 1, y - 4);
        g.stroke();
      }
      g.globalAlpha = 1;
    }

    if (biome.id === 'pantano') {
      if (seed > 0.34) {
        g.fillStyle = 'rgba(27,58,54,.35)';
        g.beginPath();
        g.ellipse(5 + seed * 18, 5 + random01(tx, ty, 4) * 18, 6 + seed * 3, 4 + seed * 2, seed * 2, 0, Math.PI * 2);
        g.fill();
      }
      g.strokeStyle = '#9ca36a';
      g.lineWidth = 1;
      if (seed > 0.65) {
        for (let i = 0; i < 3; i++) {
          const x = 7 + i * 6;
          const y = 27 + random01(tx, ty, 8 + i) * 3;
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x - 1, y - 6);
          g.stroke();
        }
      }
    }

    if (biome.id === 'deserto') {
      g.strokeStyle = 'rgba(245,222,161,.42)';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(5 + seed * 19, 5 + random01(tx, ty, 8) * 19, 6 + seed * 3, 0.12, 2.6);
      g.stroke();
      if (seed > 0.87) {
        g.fillStyle = '#42704b';
        g.fillRect(24, 19, 2, 8);
        g.fillRect(21, 22, 3, 2);
        g.fillRect(26, 23, 3, 2);
      }
    }

    if (biome.id === 'congeladas' && seed > 0.25) {
      g.fillStyle = 'rgba(230,247,248,.50)';
      g.beginPath();
      g.ellipse(5 + seed * 18, 5 + random01(tx, ty, 6) * 18, 6, 3, seed, 0, Math.PI * 2);
      g.fill();
    }

    if ((biome.id === 'campos' || biome.id === 'selva') && seed > 0.78) {
      const fx = 4 + random01(tx, ty, 27) * 23;
      const fy = 4 + random01(tx, ty, 28) * 23;
      g.fillStyle = biome.accent;
      g.fillRect(fx, fy, 2, 2);
      g.fillRect(fx - 2, fy + 1, 1, 1);
      g.fillRect(fx + 2, fy + 1, 1, 1);
    }

    if (seed > 0.975) {
      const rx = 5 + random01(tx, ty, 45) * 22;
      const ry = 5 + random01(tx, ty, 46) * 22;
      g.fillStyle = biome.accent;
      g.beginPath();
      g.moveTo(rx, ry - 5);
      g.lineTo(rx + 4, ry);
      g.lineTo(rx, ry + 5);
      g.lineTo(rx - 4, ry);
      g.closePath();
      g.fill();
    }
  }

  function decorationAt(tx, ty) {
    const key = tx + ',' + ty;
    if (decorationCache.has(key)) return decorationCache.get(key);

    const region = regionAt(tx * TILE + TILE / 2, ty * TILE + TILE / 2);
    const flowerChance = {
      campos: 0.16, floresta: 0.08, savana: 0.10, selva: 0.06
    }[region.id] || 0;
    const result = {
      region,
      flower: random01(tx, ty, region.ring + 113) < flowerChance
    };
    decorationCache.set(key, result);
    if (decorationCache.size > 8000) decorationCache.delete(decorationCache.keys().next().value);
    return result;
  }

  // O mapa não possui árvores nem obstáculos ambientais desse tipo.
  // Mantém a API para os módulos de movimento sem criar colisores invisíveis.
  function getCollisionCircles() {
    return [];
  }

  function drawDecorations(ctx, left, top, width, height, tileSize) {
    const minX = Math.floor(left / tileSize) - 1;
    const maxX = Math.floor((left + width) / tileSize) + 1;
    const minY = Math.floor(top / tileSize) - 2;
    const maxY = Math.floor((top + height) / tileSize) + 1;

    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        const wx = tx * TILE + TILE / 2;
        const wy = ty * TILE + TILE / 2;
        const decoration = decorationAt(tx, ty);
        const region = decoration.region;
        const season = region.biome.season;
        const drawX = wx - left;
        const drawY = wy - top;

        const insideCentralClearing = region.id === 'campos'
          && drawX >= width * .37 - 8
          && drawX <= width * .63 + 8
          && drawY >= height * .36 - 8
          && drawY <= height * .64 + 8;

        if (decoration.flower && !insideCentralClearing) {
          const flowers = assets.get('wildflowers_' + (season === 'winter_ice' ? 'winter' : (season || 'summer')) + '.png');
          let drewFlower = false;
          if (flowers && flowers.complete && flowers.naturalWidth >= 16 && flowers.naturalHeight >= 16) {
            const cols = Math.max(1, Math.floor(flowers.naturalWidth / 16));
            const rows = Math.max(1, Math.floor(flowers.naturalHeight / 16));
            const sx = Math.floor(random01(tx, ty, 43) * cols) * 16;
            const sy = Math.floor(random01(tx, ty, 44) * rows) * 16;
            ctx.drawImage(flowers, sx, sy, 16, 16, drawX - 6, drawY - 6, 12, 12);
            drewFlower = true;
          }
          if (!drewFlower) {
            ctx.fillStyle = region.biome.accent;
            ctx.fillRect(drawX - 1, drawY - 2, 3, 3);
            ctx.fillStyle = '#e9d99a';
            ctx.fillRect(drawX, drawY - 1, 1, 1);
          }
        }
      }
    }
  }

  // Vegetação LPC dos Campos Centrais.
  // O atlas contém sprites estáticos, não quadros próprios de animação.
  // Todos os elementos recebem balanço procedural de vento, com intensidade
  // proporcional ao porte: capins/juncos mais soltos; arbustos/samambaias sutis.
  function drawCentralVegetationAnimation(ctx, width, height, timeSeconds) {
    const plants = assets.get('plants_summer.png');
    if (!plants || !plants.complete || plants.naturalWidth < 512 || plants.naturalHeight < 160) return;

    const baseScale = Math.min(width / 1920, height / 1080) * 1.58;
    const sprites = [
      // Sete plantas da primeira linha do atlas: cada uma tem posição própria.
      { x: .12, y: .25, sx: 0,   sy: 0, sw: 32, sh: 32, phase: 0.0, amplitude: .009 },
      { x: .28, y: .17, sx: 32,  sy: 0, sw: 32, sh: 32, phase: 0.4, amplitude: .009 },
      { x: .76, y: .19, sx: 64,  sy: 0, sw: 32, sh: 32, phase: 0.8, amplitude: .009 },
      { x: .89, y: .42, sx: 96,  sy: 0, sw: 32, sh: 32, phase: 1.2, amplitude: .009 },
      { x: .84, y: .78, sx: 128, sy: 0, sw: 32, sh: 32, phase: 1.6, amplitude: .009 },
      { x: .68, y: .89, sx: 160, sy: 0, sw: 32, sh: 32, phase: 2.0, amplitude: .009 },
      { x: .27, y: .88, sx: 192, sy: 0, sw: 32, sh: 32, phase: 2.4, amplitude: .009 },

      // Sete plantas da segunda linha: sprites independentes em outras coordenadas.
      { x: .52, y: .30, sx: 0,   sy: 32, sw: 32, sh: 32, phase: .3, amplitude: .010 },
      { x: .51, y: .49, sx: 32,  sy: 32, sw: 32, sh: 32, phase: 1.1, amplitude: .010 },
      { x: .50, y: .66, sx: 64,  sy: 32, sw: 32, sh: 32, phase: 1.9, amplitude: .010 },
      { x: .33, y: .57, sx: 96,  sy: 32, sw: 32, sh: 32, phase: 2.7, amplitude: .010 },
      { x: .74, y: .46, sx: 128, sy: 32, sw: 32, sh: 32, phase: 3.5, amplitude: .010 },
      { x: .16, y: .83, sx: 160, sy: 32, sw: 32, sh: 32, phase: 4.3, amplitude: .010 },
      { x: .95, y: .84, sx: 192, sy: 32, sw: 32, sh: 32, phase: 5.1, amplitude: .010 },

      // A oitava imagem da primeira linha não tem par correspondente neste grupo.
      { x: .09, y: .69, sx: 224, sy: 0, sw: 32, sh: 32, phase: 2.1, amplitude: .009 },

      // Arbustos altos: tamanho original 32×64.
      { x: .14, y: .43, sx: 0,  sy: 64, sw: 32, sh: 64, phase: .6, amplitude: .014 },
      { x: .87, y: .67, sx: 32, sy: 64, sw: 32, sh: 64, phase: 2.9, amplitude: .013 },
      { x: .49, y: .17, sx: 64, sy: 64, sw: 32, sh: 64, phase: 5.3, amplitude: .014 },

      // Samambaias e folhagens largas.
      { x: .36, y: .80, sx: 96,  sy: 64, sw: 64, sh: 64, phase: 1.9, amplitude: .008 },
      { x: .66, y: .84, sx: 160, sy: 64, sw: 96, sh: 64, phase: 4.9, amplitude: .007 },

      // Capim baixo.
      { x: .19, y: .34, sx: 256, sy: 0, sw: 32, sh: 64, phase: .4, amplitude: .022 },
      { x: .40, y: .22, sx: 288, sy: 0, sw: 32, sh: 64, phase: 1.8, amplitude: .020 },
      { x: .73, y: .29, sx: 320, sy: 0, sw: 32, sh: 64, phase: 2.7, amplitude: .022 },
      { x: .88, y: .52, sx: 256, sy: 0, sw: 32, sh: 64, phase: 4.1, amplitude: .020 },
      { x: .78, y: .72, sx: 288, sy: 0, sw: 32, sh: 64, phase: 5.0, amplitude: .023 },
      { x: .31, y: .84, sx: 320, sy: 0, sw: 32, sh: 64, phase: 3.4, amplitude: .021 },
      { x: .12, y: .58, sx: 256, sy: 0, sw: 32, sh: 64, phase: 2.1, amplitude: .022 },

      // Touceiras de capim alto e juncos.
      { x: .22, y: .48, sx: 256, sy: 64, sw: 32, sh: 64, phase: .9, amplitude: .035 },
      { x: .66, y: .24, sx: 288, sy: 64, sw: 32, sh: 64, phase: 2.4, amplitude: .038 },
      { x: .90, y: .64, sx: 320, sy: 64, sw: 32, sh: 64, phase: 3.7, amplitude: .036 },
      { x: .39, y: .88, sx: 256, sy: 64, sw: 32, sh: 64, phase: 4.9, amplitude: .034 },
      { x: .70, y: .91, sx: 320, sy: 64, sw: 32, sh: 64, phase: 5.7, amplitude: .037 },
      { x: .12, y: .30, sx: 352, sy: 0, sw: 32, sh: 64, phase: 1.3, amplitude: .032 },
      { x: .91, y: .33, sx: 384, sy: 0, sw: 32, sh: 64, phase: 3.1, amplitude: .034 },
      { x: .55, y: .91, sx: 416, sy: 0, sw: 32, sh: 64, phase: 5.1, amplitude: .033 }
    ];
    // Ordena pelo ponto de apoio: plantas mais ao fundo são desenhadas primeiro.
    // Isso evita que um sprite distante cubra a copa de uma planta à frente.
    sprites.sort((a, b) => a.y - b.y);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    for (const sprite of sprites) {
      const drawWidth = sprite.sw * baseScale;
      const drawHeight = sprite.sh * baseScale;
      const baseX = sprite.x * width;
      const baseY = sprite.y * height;
      const sway = Math.sin(timeSeconds * 1.35 + sprite.phase) * sprite.amplitude;
      const sourceY = sprite.sy;

      // Clareira central: impede que qualquer parte visível da planta entre na área reservada.
      const clearLeft = width * .37;
      const clearRight = width * .63;
      const clearTop = height * .36;
      const clearBottom = height * .64;
      const spriteLeft = baseX - drawWidth / 2;
      const spriteRight = baseX + drawWidth / 2;
      const spriteTop = baseY - drawHeight;
      const spriteBottom = baseY;
      const overlapsClearing = spriteLeft < clearRight
        && spriteRight > clearLeft
        && spriteTop < clearBottom
        && spriteBottom > clearTop;
      if (overlapsClearing) continue;

      // O eixo fica na base de cada planta para ela não deslizar pelo chão.
      ctx.save();
      ctx.translate(baseX, baseY);
      ctx.rotate(sway);
      ctx.drawImage(
        plants,
        sprite.sx, sourceY, sprite.sw, sprite.sh,
        -drawWidth / 2, -drawHeight,
        drawWidth, drawHeight
      );
      ctx.restore();
    }
    ctx.restore();
  }

  function drawTile(tx, ty) {
    const key = tx + ',' + ty;
    if (tileCache.has(key)) return tileCache.get(key);

    const centerX = tx * TILE + TILE / 2;
    const centerY = ty * TILE + TILE / 2;
    const region = regionAt(centerX, centerY);
    const tile = document.createElement('canvas');
    tile.width = TILE;
    tile.height = TILE;
    drawGroundTile(tile.getContext('2d'), tx, ty, region);

    tileCache.set(key, tile);
    if (tileCache.size > 12000) tileCache.delete(tileCache.keys().next().value);
    return tile;
  }

  // Estrada em circuito pelos oito mapas externos. Os pontos de entrada e saída
  // coincidem nas bordas entre salas; o mapa central fica deliberadamente livre.
  const outerRoadRoutes = {
    '-1,-1': [[.37,.99],[.32,.78],[.43,.63],[.27,.49],[.49,.40],[.72,.34],[.99,.37]],
    '0,-1':  [[.01,.37],[.18,.32],[.31,.43],[.45,.30],[.58,.39],[.72,.28],[.84,.42],[.99,.37]],
    '1,-1':  [[.01,.37],[.18,.31],[.34,.42],[.48,.33],[.62,.52],[.72,.61],[.63,.99]],
    '1,0':   [[.63,.01],[.69,.18],[.57,.31],[.71,.47],[.55,.63],[.69,.79],[.63,.99]],
    '1,1':   [[.63,.01],[.72,.18],[.58,.34],[.68,.51],[.42,.66],[.22,.61],[.01,.63]],
    '0,1':   [[.99,.63],[.82,.70],[.67,.58],[.52,.72],[.35,.59],[.18,.69],[.01,.63]],
    '-1,1':  [[.99,.63],[.82,.70],[.67,.57],[.52,.67],[.38,.51],[.27,.31],[.37,.01]],
    '-1,0':  [[.37,.99],[.29,.82],[.43,.67],[.28,.51],[.42,.36],[.29,.18],[.37,.01]]
  };

  // Um lago em cada extremidade externa do anel de oito mapas.
  // As posições ficam afastadas do traçado das estradas e nunca ocupam o centro.
  const outerLakeLocations = {
    '0,-1':  { x: .50, y: .14, rx: .095, ry: .065, phase: 1.1 },
    '1,-1':  { x: .82, y: .18, rx: .078, ry: .095, phase: 2.0 },
    '0,1':   { x: .50, y: .88, rx: .095, ry: .065, phase: 4.4 },
    '-1,0':  { x: .10, y: .50, rx: .065, ry: .090, phase: 5.9 }
  };

  function traceLakeShape(g, centerX, centerY, radiusX, radiusY, phase, scale = 1) {
    const count = 16;
    const points = [];
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i / count) - Math.PI / 2;
      const variation = 1
        + Math.sin(angle * 3 + phase) * .075
        + Math.cos(angle * 5 - phase) * .045
        + Math.sin(angle * 7 + phase * 2) * .022;
      points.push({
        x: centerX + Math.cos(angle) * radiusX * variation * scale,
        y: centerY + Math.sin(angle) * radiusY * variation * scale
      });
    }

    const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const first = midpoint(points[count - 1], points[0]);
    g.beginPath();
    g.moveTo(first.x, first.y);
    for (let i = 0; i < count; i++) {
      const current = points[i];
      const nextMidpoint = midpoint(current, points[(i + 1) % count]);
      g.quadraticCurveTo(current.x, current.y, nextMidpoint.x, nextMidpoint.y);
    }
    g.closePath();
  }

  function getLakeWaterPolygon(centerX, centerY, radiusX, radiusY, phase) {
    const count = 16;
    const points = [];
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i / count) - Math.PI / 2;
      const variation = 1
        + Math.sin(angle * 3 + phase) * .075
        + Math.cos(angle * 5 - phase) * .045
        + Math.sin(angle * 7 + phase * 2) * .022;
      points.push({
        x: centerX + Math.cos(angle) * radiusX * variation,
        y: centerY + Math.sin(angle) * radiusY * variation
      });
    }

    const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const polygon = [];
    for (let i = 0; i < count; i++) {
      const previous = points[(i + count - 1) % count];
      const current = points[i];
      const next = points[(i + 1) % count];
      const start = midpoint(previous, current);
      const end = midpoint(current, next);

      for (let step = 0; step < 8; step++) {
        const t = step / 8;
        const inverse = 1 - t;
        polygon.push({
          x: inverse * inverse * start.x + 2 * inverse * t * current.x + t * t * end.x,
          y: inverse * inverse * start.y + 2 * inverse * t * current.y + t * t * end.y
        });
      }
    }
    return polygon;
  }

  function isPointInsidePolygon(x, y, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i];
      const b = polygon[j];
      const crosses = (a.y > y) !== (b.y > y);
      if (crosses && x < ((b.x - a.x) * (y - a.y)) / ((b.y - a.y) || 1e-9) + a.x) {
        inside = !inside;
      }
    }
    return inside;
  }

  // Coordenadas globais: retorna true apenas sobre a superfície azul do lago,
  // respeitando a mesma margem irregular usada no desenho.
  function isInLake(worldX, worldY) {
    const x = Number(worldX);
    const y = Number(worldY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;

    const room = roomAt(x, y);
    const roomCol = room.col - GRID_CENTER;
    const roomRow = room.row - GRID_CENTER;
    const lake = outerLakeLocations[`${roomCol},${roomRow}`];
    if (!lake) return false;

    const centerX = lake.x * viewWidth;
    const centerY = lake.y * viewHeight;
    const localX = x - roomCol * viewWidth + viewWidth / 2;
    const localY = y - roomRow * viewHeight + viewHeight / 2;
    const polygon = getLakeWaterPolygon(
      centerX,
      centerY,
      lake.rx * viewWidth * .79,
      lake.ry * viewHeight * .79,
      lake.phase
    );
    return isPointInsidePolygon(localX, localY, polygon);
  }

  function isInWater(worldX, worldY) {
    if (isInLake(worldX, worldY)) return true;
    const x = Number(worldX);
    const y = Number(worldY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const biomeId = roomAt(x, y).id;
    return biomeId === 'aguas-quentes' || biomeId === 'oceano-polar';
  }

  function drawOuterLake(g, roomCol, roomRow, width, height) {
    const lake = outerLakeLocations[`${roomCol},${roomRow}`];
    if (!lake) return;

    const centerX = lake.x * width;
    const centerY = lake.y * height;
    const radiusX = lake.rx * width;
    const radiusY = lake.ry * height;
    const scale = Math.min(width / 1920, height / 1080);

    g.save();

    // Sombra e margem de terra dão volume à margem irregular.
    g.shadowColor = 'rgba(24,37,27,.34)';
    g.shadowBlur = 12 * scale;
    g.shadowOffsetY = 5 * scale;
    traceLakeShape(g, centerX, centerY, radiusX, radiusY, lake.phase, 1.13);
    g.fillStyle = 'rgba(28,43,31,.45)';
    g.fill();

    g.shadowColor = 'transparent';
    g.shadowBlur = 0;
    g.shadowOffsetY = 0;

    traceLakeShape(g, centerX, centerY, radiusX, radiusY, lake.phase, 1.08);
    g.fillStyle = '#77734f';
    g.fill();

    traceLakeShape(g, centerX, centerY, radiusX, radiusY, lake.phase, .99);
    g.fillStyle = '#a89a68';
    g.fill();

    // Faixa rasa esverdeada entre a margem e a água mais profunda.
    traceLakeShape(g, centerX, centerY, radiusX, radiusY, lake.phase, .91);
    g.fillStyle = '#648d76';
    g.fill();

    const waterGradient = g.createLinearGradient(
      centerX - radiusX, centerY - radiusY,
      centerX + radiusX, centerY + radiusY
    );
    waterGradient.addColorStop(0, '#5a9b9a');
    waterGradient.addColorStop(.48, '#397e8b');
    waterGradient.addColorStop(1, '#285d73');
    traceLakeShape(g, centerX, centerY, radiusX, radiusY, lake.phase, .79);
    g.fillStyle = waterGradient;
    g.fill();

    // Reflexos discretos sobre a água.
    g.strokeStyle = 'rgba(205,231,218,.50)';
    g.lineWidth = Math.max(1, 2 * scale);
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(centerX - radiusX * .37, centerY - radiusY * .34);
    g.quadraticCurveTo(
      centerX - radiusX * .12, centerY - radiusY * .49,
      centerX + radiusX * .17, centerY - radiusY * .34
    );
    g.stroke();

    g.strokeStyle = 'rgba(193,224,215,.32)';
    g.lineWidth = Math.max(1, 1.4 * scale);
    g.beginPath();
    g.moveTo(centerX + radiusX * .12, centerY + radiusY * .13);
    g.quadraticCurveTo(
      centerX + radiusX * .31, centerY + radiusY * .04,
      centerX + radiusX * .43, centerY + radiusY * .13
    );
    g.stroke();

    // Pequenos tufos nas margens, sem fechar o acesso ao lago.
    const reeds = [
      [-.76, -.28], [.70, -.48], [.45, .72]
    ];
    reeds.forEach(([offsetX, offsetY], index) => {
      const x = centerX + radiusX * offsetX;
      const y = centerY + radiusY * offsetY;
      g.strokeStyle = index % 2 ? '#667b48' : '#78884a';
      g.lineWidth = Math.max(1, 2 * scale);
      for (let blade = -1; blade <= 1; blade++) {
        g.beginPath();
        g.moveTo(x + blade * 3 * scale, y + 5 * scale);
        g.quadraticCurveTo(
          x + blade * 5 * scale,
          y - 2 * scale,
          x + blade * 7 * scale,
          y - (8 + Math.abs(blade) * 2) * scale
        );
        g.stroke();
      }
    });

    g.restore();
  }

  // Ondulações e reflexos são desenhados fora do canvas em cache para que
  // possam se mover continuamente sem reconstruir o cenário a cada quadro.
  function drawOuterLakeAnimation(g, roomCol, roomRow, width, height, timeSeconds) {
    const lake = outerLakeLocations[`${roomCol},${roomRow}`];
    if (!lake) return;

    const centerX = lake.x * width;
    const centerY = lake.y * height;
    const radiusX = lake.rx * width;
    const radiusY = lake.ry * height;
    const scale = Math.min(width / 1920, height / 1080);

    g.save();
    traceLakeShape(g, centerX, centerY, radiusX, radiusY, lake.phase, .79);
    g.clip();
    g.lineCap = 'round';
    g.lineJoin = 'round';

    // Uma faixa de luz atravessa a água continuamente, tornando o movimento
    // perceptível mesmo quando o jogador está parado.
    for (let i = 0; i < 7; i++) {
      const speed = 34 + (i % 3) * 11;
      const travel = radiusX * 2.05 + 90 * scale;
      const offset = ((timeSeconds * speed + i * travel / 7) % travel) - travel / 2;
      const x = centerX + offset;
      const y = centerY + Math.sin(timeSeconds * .72 + i * 1.7 + lake.phase) * radiusY * .38;
      const length = (22 + (i % 3) * 13) * scale;
      const curve = Math.sin(timeSeconds * 1.35 + i + lake.phase) * 4.5 * scale;
      const opacity = .24 + .18 * (.5 + .5 * Math.sin(timeSeconds * 1.1 + i));

      g.strokeStyle = `rgba(211,240,229,${opacity.toFixed(3)})`;
      g.lineWidth = Math.max(1.5, 2.5 * scale);
      g.beginPath();
      g.moveTo(x - length, y);
      g.quadraticCurveTo(x, y + curve, x + length, y - curve * .45);
      g.stroke();
    }

    // Dois conjuntos de ondas se expandem e recomeçam em ciclos independentes.
    const rippleOrigins = [
      { x: centerX - radiusX * .18, y: centerY - radiusY * .10, offset: .0 },
      { x: centerX + radiusX * .22, y: centerY + radiusY * .16, offset: .52 }
    ];
    rippleOrigins.forEach(origin => {
      const progress = ((timeSeconds / 3.4 + origin.offset + lake.phase * .08) % 1);
      const rippleRadius = .10 + progress * .88;
      const opacity = .46 * (1 - progress);
      g.strokeStyle = `rgba(193,231,221,${opacity.toFixed(3)})`;
      g.lineWidth = Math.max(1.3, 2.2 * scale);
      g.beginPath();
      g.ellipse(
        origin.x,
        origin.y,
        radiusX * .46 * rippleRadius,
        radiusY * .43 * rippleRadius,
        0, 0, Math.PI * 2
      );
      g.stroke();
    });

    // Reflexos pequenos deslizam em diagonal sobre as ondulações maiores.
    for (let i = 0; i < 5; i++) {
      const phase = timeSeconds * .95 + lake.phase + i * 1.26;
      const x = centerX + Math.sin(phase) * radiusX * .52;
      const y = centerY + Math.cos(phase * .83 + i) * radiusY * .39;
      const opacity = .25 + .22 * (.5 + .5 * Math.sin(phase * 1.8));
      g.fillStyle = `rgba(231,246,231,${opacity.toFixed(3)})`;
      g.beginPath();
      g.ellipse(
        x, y,
        (4.5 + (i % 2) * 2) * scale,
        1.6 * scale,
        Math.sin(phase) * .22,
        0, Math.PI * 2
      );
      g.fill();
    }

    g.restore();
  }

  function traceRoadPath(g, points, width, height) {
    g.beginPath();
    g.moveTo(points[0][0] * width, points[0][1] * height);
    for (let i = 1; i < points.length - 1; i++) {
      const current = points[i];
      const next = points[i + 1];
      const midX = (current[0] + next[0]) * width / 2;
      const midY = (current[1] + next[1]) * height / 2;
      g.quadraticCurveTo(current[0] * width, current[1] * height, midX, midY);
    }
    const last = points[points.length - 1];
    g.lineTo(last[0] * width, last[1] * height);
  }

  function sampleRoadPolyline(points, progress, width, height) {
    const coords = points.map(point => [point[0] * width, point[1] * height]);
    const lengths = [];
    let total = 0;
    for (let i = 1; i < coords.length; i++) {
      const length = Math.hypot(coords[i][0] - coords[i - 1][0], coords[i][1] - coords[i - 1][1]);
      lengths.push(length);
      total += length;
    }
    let remaining = Math.max(0, Math.min(1, progress)) * total;
    for (let i = 0; i < lengths.length; i++) {
      if (remaining <= lengths[i] || i === lengths.length - 1) {
        const a = coords[i];
        const b = coords[i + 1];
        const t = lengths[i] ? Math.max(0, Math.min(1, remaining / lengths[i])) : 0;
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const distance = Math.hypot(dx, dy) || 1;
        return {
          x: a[0] + dx * t,
          y: a[1] + dy * t,
          tangentX: dx / distance,
          tangentY: dy / distance
        };
      }
      remaining -= lengths[i];
    }
    return {x:coords[0][0],y:coords[0][1],tangentX:1,tangentY:0};
  }

  function distanceToSegmentSquared(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared > 0
      ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared))
      : 0;
    const nearestX = ax + dx * t;
    const nearestY = ay + dy * t;
    const distanceX = px - nearestX;
    const distanceY = py - nearestY;
    return distanceX * distanceX + distanceY * distanceY;
  }

  // Usa o mesmo caminho curvo desenhado pela estrada para detectar o terreno
  // sob o jogador. As coordenadas recebidas são globais, como as da rede.
  function isOnRoad(worldX, worldY) {
    const x = Number(worldX);
    const y = Number(worldY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;

    const room = roomAt(x, y);
    const roomCol = room.col - GRID_CENTER;
    const roomRow = room.row - GRID_CENTER;
    const route = outerRoadRoutes[`${roomCol},${roomRow}`];
    if (!route) return false;

    const localX = x - roomCol * viewWidth + viewWidth / 2;
    const localY = y - roomRow * viewHeight + viewHeight / 2;
    const scale = Math.min(viewWidth / 1920, viewHeight / 1080);
    const detectionRadius = Math.max(22, 76 * scale) / 2 + 5 * scale;
    const detectionRadiusSquared = detectionRadius * detectionRadius;
    let nearestDistanceSquared = Infinity;

    const considerSegment = (ax, ay, bx, by) => {
      nearestDistanceSquared = Math.min(
        nearestDistanceSquared,
        distanceToSegmentSquared(localX, localY, ax, ay, bx, by)
      );
    };

    let startX = route[0][0] * viewWidth;
    let startY = route[0][1] * viewHeight;

    // Amostra as curvas quadráticas com a mesma sequência de pontos usada
    // em traceRoadPath, sem consultar pixels nem depender da resolução.
    for (let i = 1; i < route.length - 1; i++) {
      const controlX = route[i][0] * viewWidth;
      const controlY = route[i][1] * viewHeight;
      const next = route[i + 1];
      const endX = (route[i][0] + next[0]) * viewWidth / 2;
      const endY = (route[i][1] + next[1]) * viewHeight / 2;
      let previousX = startX;
      let previousY = startY;

      for (let step = 1; step <= 12; step++) {
        const t = step / 12;
        const inverse = 1 - t;
        const currentX = inverse * inverse * startX +
          2 * inverse * t * controlX + t * t * endX;
        const currentY = inverse * inverse * startY +
          2 * inverse * t * controlY + t * t * endY;
        considerSegment(previousX, previousY, currentX, currentY);
        previousX = currentX;
        previousY = currentY;
      }

      startX = endX;
      startY = endY;
    }

    const last = route[route.length - 1];
    considerSegment(startX, startY, last[0] * viewWidth, last[1] * viewHeight);
    return nearestDistanceSquared <= detectionRadiusSquared;
  }

  function drawOuterRoad(g, roomCol, roomRow, width, height) {
    const route = outerRoadRoutes[`${roomCol},${roomRow}`];
    if (!route) return;

    const scale = Math.min(width / 1920, height / 1080);
    const roadWidth = Math.max(22, 76 * scale);
    g.save();
    g.lineCap = 'round';
    g.lineJoin = 'round';

    traceRoadPath(g, route, width, height);
    g.strokeStyle = 'rgba(42,32,23,.46)';
    g.lineWidth = roadWidth + 18 * scale;
    g.stroke();

    traceRoadPath(g, route, width, height);
    g.strokeStyle = '#5d4932';
    g.lineWidth = roadWidth + 10 * scale;
    g.stroke();

    traceRoadPath(g, route, width, height);
    g.strokeStyle = '#98784e';
    g.lineWidth = roadWidth;
    g.stroke();

    // Pequenas irregularidades nas margens evitam o aspecto de faixa geométrica.
    for (let i = 0; i <= 38; i++) {
      const sample = sampleRoadPolyline(route, i / 38, width, height);
      const side = random01(i + roomCol * 31, roomRow * 47 + i, 71) < .5 ? -1 : 1;
      const offset = roadWidth * (.43 + random01(i, roomCol + roomRow * 13, 72) * .17);
      const radius = (3 + random01(i, roomRow, 73) * 6) * scale;
      const x = sample.x - sample.tangentY * offset * side;
      const y = sample.y + sample.tangentX * offset * side;
      g.fillStyle = i % 2 ? 'rgba(153,121,77,.92)' : 'rgba(111,83,52,.82)';
      g.beginPath();
      g.ellipse(x, y, radius * 1.5, radius, Math.atan2(sample.tangentY, sample.tangentX), 0, Math.PI * 2);
      g.fill();
    }

    traceRoadPath(g, route, width, height);
    g.strokeStyle = 'rgba(209,181,135,.39)';
    g.lineWidth = roadWidth * .40;
    g.stroke();

    // Grãos e pequenas marcas de terra, distribuídos de forma determinística.
    for (let i = 0; i < 86; i++) {
      const sample = sampleRoadPolyline(route, (i + .37) / 87, width, height);
      const across = (random01(i + roomCol * 19, roomRow * 23 + i, 74) - .5) * roadWidth * .72;
      const x = sample.x - sample.tangentY * across;
      const y = sample.y + sample.tangentX * across;
      const radius = (.55 + random01(i, roomCol - roomRow * 11, 75) * 1.5) * scale;
      g.fillStyle = i % 3 ? 'rgba(62,48,34,.24)' : 'rgba(230,207,164,.42)';
      g.beginPath();
      g.ellipse(x, y, radius * 1.5, radius, 0, 0, Math.PI * 2);
      g.fill();
    }

    g.restore();
  }

  function buildRoomCanvas(roomCol, roomRow, width, height) {
    const roomCanvas = document.createElement('canvas');
    roomCanvas.width = Math.max(1, Math.round(width));
    roomCanvas.height = Math.max(1, Math.round(height));
    const roomCtx = roomCanvas.getContext('2d');
    const left = roomCol * width - width / 2;
    const top = roomRow * height - height / 2;
    const size = TILE;

    roomCtx.imageSmoothingEnabled = false;
    const roomId = layout[roomRow + GRID_CENTER]?.[roomCol + GRID_CENTER] || 'campos';
    const isCssGrassRoom = roomId === 'campos' || roomId === 'vazio';
    if (!isCssGrassRoom) {
      roomCtx.fillStyle = '#263f59';
      roomCtx.fillRect(0, 0, width, height);
    }

    const minX = Math.floor(left / size) - 1;
    const maxX = Math.floor((left + width) / size) + 1;
    const minY = Math.floor(top / size) - 1;
    const maxY = Math.floor((top + height) / size) + 1;

    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        const worldX = tx * size;
        const worldY = ty * size;
        roomCtx.drawImage(drawTile(tx, ty), worldX - left, worldY - top, size, size);
      }
    }

    drawDecorations(roomCtx, left, top, width, height, size);
    drawOuterLake(roomCtx, roomCol, roomRow, width, height);
    drawOuterRoad(roomCtx, roomCol, roomRow, width, height);
    return roomCanvas;
  }

  function draw(ctx, left, top, width, height, tileSize = TILE) {
    if (!ctx || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    setViewport(width, height);

    // O retângulo recebido deve representar exatamente uma sala 16:9.
    // Descobrimos a coordenada dela pelo centro do retângulo global.
    const roomCol = Math.round((left + width / 2) / width);
    const roomRow = Math.round((top + height / 2) / height);

    // Cada sala identifica sua própria variação de grama CSS no canvas principal.
    if (ctx.canvas?.dataset) {
      const cssCol = Math.max(0, Math.min(layout[0].length - 1, roomCol + GRID_CENTER));
      const cssRow = Math.max(0, Math.min(layout.length - 1, roomRow + GRID_CENTER));
      ctx.canvas.setAttribute('data-grass-room', `${cssCol}-${cssRow}`);
    }

    const cacheKey = `${roomCol},${roomRow},${Math.round(width)}x${Math.round(height)}`;
    let roomCanvas = roomCanvasCache.get(cacheKey);

    if (!roomCanvas) {
      roomCanvas = buildRoomCanvas(roomCol, roomRow, width, height);
      roomCanvasCache.set(cacheKey, roomCanvas);
      if (roomCanvasCache.size > 8) roomCanvasCache.delete(roomCanvasCache.keys().next().value);
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(roomCanvas, 0, 0, width, height);
    const animationTime = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    if (roomCol === 0 && roomRow === 0) drawCentralVegetationAnimation(ctx, width, height, animationTime);
    drawOuterLakeAnimation(ctx, roomCol, roomRow, width, height, animationTime);
    ctx.restore();
  }

  function clearCache() {
    tileCache.clear();
    decorationCache.clear();
    roomCanvasCache.clear();
  }

  window.KTKWorldMap = {
    defaultMap: DEFAULT_MAP,
    draw,
    getCollisionCircles,
    isOnRoad,
    isInLake,
    isInWater,
    regionAt,
    getBiomeAt,
    biomes,
    layout,
    setViewport,
    clearCache,
    get bounds() { return { x: viewWidth / 2, y: viewHeight / 2 }; },
    tileSize: TILE,
    get regionSize() { return { width: viewWidth, height: viewHeight }; },
    get roomLimits() { return getRoomLimits(); },
    get layoutSize() { return { columns: layout[0].length, rows: layout.length }; }
  };
})();
