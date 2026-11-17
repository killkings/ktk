const TILE = 64;

function hash(x, y, seed = 0) {
  let value = Math.imul((x | 0) ^ Math.imul((y | 0) + 1013 + (Number(seed) | 0), 0x045d9f3b), 0x27d4eb2d);
  value = Math.imul(value ^ (value >>> 15), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function drawTerrain(ctx, width, height, cameraX, cameraY, seed) {
  const left = cameraX - width / 2;
  const top = cameraY - height / 2;
  const firstX = Math.floor(left / TILE);
  const firstY = Math.floor(top / TILE);
  const columns = Math.ceil(width / TILE) + 2;
  const rows = Math.ceil(height / TILE) + 2;
  ctx.fillStyle = "#668d4d";
  ctx.fillRect(0, 0, width, height);

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const worldX = firstX + column;
      const worldY = firstY + row;
      const screenX = worldX * TILE - left;
      const screenY = worldY * TILE - top;
      const value = hash(worldX, worldY, seed);
      ctx.fillStyle = value > 0.82 ? "#729957" : value < 0.12 ? "#5d8148" : "#698f50";
      ctx.fillRect(screenX, screenY, TILE, TILE);
      const detailCount = 2 + Math.floor(hash(worldX + 31, worldY - 11, seed) * 4);
      for (let i = 0; i < detailCount; i++) {
        const dx = hash(worldX * 13 + i, worldY * 7 - i, seed) * (TILE - 8) + 4;
        const dy = hash(worldY * 17 - i, worldX * 5 + i, seed) * (TILE - 8) + 4;
        ctx.fillStyle = i % 2 ? "#8eab60" : "#4d7441";
        ctx.fillRect(screenX + dx, screenY + dy, 2, 2);
      }
    }
  }
}

function drawPlayer(ctx, player, cameraX, cameraY, lpcRenderer, deltaSeconds) {
  const x = player.visualX - cameraX;
  const y = player.visualY - cameraY;
  ctx.fillStyle = "#17201566";
  ctx.beginPath();
  ctx.ellipse(x, y + 27, 20, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  // Local and remote players use this exact same LPC layer loader and painter.
  if (lpcRenderer) lpcRenderer.draw(ctx, player, x, y, deltaSeconds);
  else {
    ctx.fillStyle = "#e7dfc5";
    ctx.fillRect(x - 9, y - 10, 18, 28);
  }

  ctx.font = "12px system-ui";
  ctx.textAlign = "center";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#15271acc";
  ctx.strokeText(player.displayName, x, y - 49);
  ctx.fillStyle = "#fff";
  ctx.fillText(player.displayName, x, y - 49);
}

export function renderWorld(canvas, players, localUserId, deltaSeconds, entities = [], worldSeed = 0, kingUserId = null, lpcRenderer = null) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const viewWidth = rect.width;
  const viewHeight = rect.height;
  const local = players.find(player => player.userId === localUserId) || players[0];
  if (!local) {
    ctx.fillStyle = "#183d2b";
    ctx.fillRect(0, 0, viewWidth, viewHeight);
    return;
  }
  const cameraX = local.visualX;
  const cameraY = local.visualY;
  drawTerrain(ctx, viewWidth, viewHeight, cameraX, cameraY, worldSeed);
  const ordered = [...players].sort((a,b) => a.visualY - b.visualY);
  ordered.forEach(player => drawPlayer(
    ctx, player, cameraX - viewWidth / 2, cameraY - viewHeight / 2, lpcRenderer, deltaSeconds
  ));
  entities.forEach(entity => drawEntity(
    ctx, entity, cameraX - viewWidth / 2, cameraY - viewHeight / 2
  ));
  const king = players.find(player => player.userId === kingUserId);
  if (king) {
    const crownX = king.visualX - (cameraX - viewWidth / 2);
    const crownY = king.visualY - (cameraY - viewHeight / 2) - 54;
    ctx.fillStyle = "#f4d35e";
    ctx.font = "18px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("♛", crownX, crownY);
  }
}

function drawEntity(ctx, entity, cameraX, cameraY) {
  if (!entity || entity.state?.status === "held") return;
  const x = Number(entity.x) - cameraX;
  const y = Number(entity.y) - cameraY;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  if (entity.entity_type === "crown") {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "#f0d35c";
    ctx.beginPath();
    ctx.moveTo(0,-12); ctx.lineTo(4,-4); ctx.lineTo(12,-8);
    ctx.lineTo(9,5); ctx.lineTo(-9,5); ctx.lineTo(-12,-8); ctx.lineTo(-4,-4);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#5e491d"; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = "#fff0a6"; ctx.fillRect(-6,6,12,3);
    ctx.restore();
  } else if (entity.entity_type === "enemy") {
    ctx.fillStyle = "#c5c9c3";
    ctx.beginPath(); ctx.arc(x,y,10,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle = "#353a37"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "#782e27"; ctx.fillRect(x-5,y-2,3,2); ctx.fillRect(x+2,y-2,3,2);
  } else if (entity.entity_type === "item") {
    ctx.fillStyle = "#d7c28b";
    ctx.fillRect(x-5,y-5,10,10);
    ctx.strokeStyle = "#493e2b"; ctx.strokeRect(x-5,y-5,10,10);
  }
}
