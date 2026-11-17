const TILE = 64;

function hash(x, y) {
  let value = Math.imul((x | 0) ^ Math.imul((y | 0) + 1013, 0x045d9f3b), 0x27d4eb2d);
  value = Math.imul(value ^ (value >>> 15), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function drawTerrain(ctx, width, height, cameraX, cameraY) {
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
      const value = hash(worldX, worldY);
      ctx.fillStyle = value > 0.82 ? "#729957" : value < 0.12 ? "#5d8148" : "#698f50";
      ctx.fillRect(screenX, screenY, TILE, TILE);
      const detailCount = 2 + Math.floor(hash(worldX + 31, worldY - 11) * 4);
      for (let i = 0; i < detailCount; i++) {
        const dx = hash(worldX * 13 + i, worldY * 7 - i) * (TILE - 8) + 4;
        const dy = hash(worldY * 17 - i, worldX * 5 + i) * (TILE - 8) + 4;
        ctx.fillStyle = i % 2 ? "#8eab60" : "#4d7441";
        ctx.fillRect(screenX + dx, screenY + dy, 2, 2);
      }
    }
  }
}

function drawPlayer(ctx, player, cameraX, cameraY, localUserId) {
  const x = player.visualX - cameraX;
  const y = player.visualY - cameraY;
  const isLocal = player.userId === localUserId;
  ctx.fillStyle = "#17201566";
  ctx.beginPath();
  ctx.ellipse(x, y + 8, 12, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = isLocal ? "#e7dfc5" : (player.clanColor || "#9ab7d2");
  ctx.beginPath();
  ctx.arc(x, y, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = isLocal ? "#273522" : "#17251c";
  ctx.lineWidth = 2;
  ctx.stroke();

  const directions = [[0,-5],[-5,0],[0,5],[5,0]];
  const [dx,dy] = directions[player.direction] || directions[2];
  ctx.fillStyle = "#17251a";
  ctx.beginPath();
  ctx.arc(x + dx, y + dy, 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.font = "12px system-ui";
  ctx.textAlign = "center";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#15271acc";
  ctx.strokeText(player.displayName, x, y - 17);
  ctx.fillStyle = "#fff";
  ctx.fillText(player.displayName, x, y - 17);
}

export function renderWorld(canvas, players, localUserId, deltaSeconds) {
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
  drawTerrain(ctx, viewWidth, viewHeight, cameraX, cameraY);
  const ordered = [...players].sort((a,b) => a.visualY - b.visualY);
  ordered.forEach(player => drawPlayer(
    ctx, player, cameraX - viewWidth / 2, cameraY - viewHeight / 2, localUserId
  ));
}
