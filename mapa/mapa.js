/*
 * Kill the King — Gerador de mapas em salas 16:9
 * Cada sala ocupa uma tela. A câmera aponta para a coordenada da sala atual.
 * O terreno procedural sempre é desenhado; os tilesets LPC são opcionais.
 */
(() => {
  'use strict';

  const TILE = 32;
  let viewWidth = 1920;
  let viewHeight = 1080;
  const assetRoot = './mapa/LPC-main/Terrain/';
  const tileCache = new Map();
  const decorationCache = new Map();
  const roomCanvasCache = new Map();
  const assets = new Map();
  const assetStatus = new Map();

  // Textura LPC exclusiva para as oito salas externas. Não altera os Campos Centrais.
  const emptyGrassAsset = new Image();
  emptyGrassAsset.onload = () => {
    tileCache.clear();
    roomCanvasCache.clear();
  };
  emptyGrassAsset.onerror = () => {
    // Se a arte não carregar, o piso verde original continua como fallback.
  };
  emptyGrassAsset.src = './mapa/assets/lpc-terrain-summer.png';

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

  // Norte em cima; os Campos Centrais ocupam a sala central (0, 0).
  const layout = [
    ['vazio', 'vazio', 'vazio'],
    ['vazio', 'campos', 'vazio'],
    ['vazio', 'vazio', 'vazio']
  ];
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
    image.src = assetRoot + file;
    assets.set(file, image);
  }

  ['terrain_summer.png', 'wildflowers_summer.png'].forEach(loadAsset);

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

    // Salas externas vazias: mesmo chão verde do mapa central, sem vegetação,
    // flores, recursos visuais ou obstáculos.
    if (biome.id === 'vazio') {
      if (emptyGrassAsset.complete &&
          emptyGrassAsset.naturalWidth >= 112 &&
          emptyGrassAsset.naturalHeight >= 48) {
        // Amostra de grama LPC (16×16) ampliada em pixel art para 32×32.
        // Pequenas inversões determinísticas reduzem a repetição visual entre tiles.
        const flipX = random01(tx, ty, 801) > 0.5;
        const flipY = random01(tx, ty, 802) > 0.5;
        g.save();
        g.translate(flipX ? TILE : 0, flipY ? TILE : 0);
        g.scale(flipX ? -1 : 1, flipY ? -1 : 1);
        g.drawImage(emptyGrassAsset, 96, 32, 16, 16, 0, 0, TILE, TILE);
        g.restore();
      } else {
        g.fillStyle = biome.base;
        g.fillRect(0, 0, TILE, TILE);
      }
      return;
    }

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

        if (decoration.flower) {
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

  function buildRoomCanvas(roomCol, roomRow, width, height) {
    const roomCanvas = document.createElement('canvas');
    roomCanvas.width = Math.max(1, Math.round(width));
    roomCanvas.height = Math.max(1, Math.round(height));
    const roomCtx = roomCanvas.getContext('2d');
    const left = roomCol * width - width / 2;
    const top = roomRow * height - height / 2;
    const size = TILE;

    roomCtx.imageSmoothingEnabled = false;
    roomCtx.fillStyle = '#263f59';
    roomCtx.fillRect(0, 0, width, height);

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
    return roomCanvas;
  }

  function draw(ctx, left, top, width, height, tileSize = TILE) {
    if (!ctx || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    setViewport(width, height);

    // O retângulo recebido deve representar exatamente uma sala 16:9.
    // Descobrimos a coordenada dela pelo centro do retângulo global.
    const roomCol = Math.round((left + width / 2) / width);
    const roomRow = Math.round((top + height / 2) / height);
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
    ctx.restore();
  }

  function clearCache() {
    tileCache.clear();
    decorationCache.clear();
    roomCanvasCache.clear();
  }

  window.KTKWorldMap = {
    draw,
    getCollisionCircles,
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
