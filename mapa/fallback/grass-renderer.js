/* Desenho alternativo do terreno. Não participa do controlador nem do mapa principal. */
(() => {
  'use strict';

  const TILE = 32;
  const grassTileCache = new Map();

  function hash2(x, y) {
    let n = Math.imul(x ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(y ^ 0xc2b2ae35, 0x27d4eb2f);
    n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
    n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  }

  function makeGrassTile(tx, ty) {
    const key = `${tx},${ty}`;
    if (grassTileCache.has(key)) return grassTileCache.get(key);

    const tile = document.createElement('canvas');
    tile.width = TILE;
    tile.height = TILE;
    const context = tile.getContext('2d');
    const seed = hash2(tx, ty);

    context.fillStyle = '#67964f';
    context.fillRect(0, 0, TILE, TILE);
    const shade = Math.floor(seed * 11);
    context.fillStyle = `rgba(${24 + shade},${76 + shade},${31 + Math.floor(shade * 0.45)},${0.025 + seed * 0.035})`;
    context.fillRect(0, 0, TILE, TILE);

    const count = 11 + Math.floor(seed * 10);
    for (let i = 0; i < count; i++) {
      const r1 = hash2(tx * 31 + i * 7, ty * 19 - i * 13);
      const r2 = hash2(tx * 17 - i * 11, ty * 29 + i * 5);
      const x = 5 + r1 * (TILE - 10);
      const y = 5 + r2 * (TILE - 10);
      const len = 3.5 + hash2(tx + i, ty - i) * 5.5;
      const lean = (hash2(tx - i * 3, ty + i * 2) - 0.5) * 5;

      context.lineWidth = 1 + r1 * 0.45;
      context.lineCap = 'round';
      context.strokeStyle = r2 > 0.52 ? 'rgba(31,91,42,.31)' : 'rgba(202,224,135,.25)';
      context.beginPath();
      context.moveTo(x, y + len * 0.35);
      context.quadraticCurveTo(x + lean * 0.25, y - len * 0.2, x + lean, y - len);
      context.stroke();

      if (i % 4 === 0) {
        context.strokeStyle = 'rgba(219,231,160,.19)';
        context.lineWidth = 0.8;
        context.beginPath();
        context.moveTo(x - 2, y + 1);
        context.lineTo(x - 2.8, y - len * 0.48);
        context.stroke();
      }
    }

    if (seed > 0.72) {
      context.fillStyle = 'rgba(190,214,125,.035)';
      context.beginPath();
      context.ellipse(TILE * 0.5, TILE * 0.5, 18 + seed * 10, 12 + seed * 8, seed * 2, 0, Math.PI * 2);
      context.fill();
    }

    grassTileCache.set(key, tile);
    if (grassTileCache.size > 1200) grassTileCache.delete(grassTileCache.keys().next().value);
    return tile;
  }

  function draw(context, left, top, width, height) {
    if (!context || !Number.isFinite(left) || !Number.isFinite(top)
      || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return false;
    }

    context.fillStyle = '#67964f';
    context.fillRect(0, 0, width, height);
    const minX = Math.floor(left / TILE) - 1;
    const maxX = Math.floor((left + width) / TILE) + 1;
    const minY = Math.floor(top / TILE) - 1;
    const maxY = Math.floor((top + height) / TILE) + 1;

    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        context.drawImage(makeGrassTile(tx, ty), tx * TILE - left, ty * TILE - top);
      }
    }
    return true;
  }

  function clearCache() {
    grassTileCache.clear();
  }

  window.KTKGrassFallback = { draw, clearCache, tileSize: TILE };
})();
