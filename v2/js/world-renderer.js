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
  const clanColor = String(player.clanColor || "");
  ctx.save();
  if (clanColor) {
    ctx.strokeStyle = clanColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y + 7, 23, 0, Math.PI * 2);
    ctx.stroke();
  }
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

  const health = Math.max(0, Number(player.state?.health) || 0);
  const maxHealth = Math.max(1, Number(player.state?.max_health) || 100);
  if (health < maxHealth) {
    ctx.fillStyle = "#202a21";
    ctx.fillRect(x - 18, y - 38, 36, 4);
    ctx.fillStyle = "#b84d42";
    ctx.fillRect(x - 18, y - 38, 36 * Math.min(1, health / maxHealth), 4);
  }
  ctx.font = "12px system-ui";
  ctx.textAlign = "center";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#15271acc";
  ctx.strokeText(player.displayName, x, y - 49);
  ctx.fillStyle = "#fff";
  ctx.fillText(player.displayName, x, y - 49);
  ctx.restore();
}
function drawEntity(ctx, entity, cameraX, cameraY) {
  if (!entity || entity.state?.status === "held") return;
  const x = Number(entity.x) - cameraX;
  const y = Number(entity.y) - cameraY;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const state = entity.state && typeof entity.state === "object" ? entity.state : {};

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
    return;
  }

  if (entity.entity_type === "enemy") {
    const defeated = Boolean(state.defeated) || Number(state.health) <= 0;
    if (defeated) return;
    ctx.save();
    ctx.translate(x,y);
    ctx.lineCap = "round";
    ctx.strokeStyle = "#d1d4ce";
    ctx.lineWidth = 4;
    ctx.beginPath();ctx.moveTo(0,-2);ctx.lineTo(0,12);ctx.stroke();
    ctx.beginPath();ctx.moveTo(0,2);ctx.lineTo(-9,9);ctx.moveTo(0,2);ctx.lineTo(9,9);ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath();ctx.moveTo(0,12);ctx.lineTo(-7,22);ctx.moveTo(0,12);ctx.lineTo(7,22);ctx.stroke();
    ctx.fillStyle = "#d8d9d1";
    ctx.beginPath();ctx.arc(0,-9,8,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle = "#4a514c";ctx.lineWidth = 1.5;ctx.stroke();
    ctx.fillStyle = "#772e28";
    ctx.fillRect(-4,-11,2,2);ctx.fillRect(2,-11,2,2);
    ctx.restore();
    drawEntityHealth(ctx,x,y-27,state);
    return;
  }

  if (entity.entity_type === "resource") {
    if (state.status === "depleted") {
      ctx.fillStyle = "#625b4b";
      ctx.beginPath();ctx.ellipse(x,y+5,12,6,0,0,Math.PI*2);ctx.fill();
      return;
    }
    const kind = String(state.resource_kind || "");
    ctx.save();
    if (kind === "tree") {
      ctx.fillStyle="#64452d";ctx.fillRect(x-5,y-1,10,24);
      ctx.fillStyle="#2c673a";ctx.beginPath();ctx.arc(x,y-9,19,0,Math.PI*2);ctx.fill();
      ctx.fillStyle="#43834a";ctx.beginPath();ctx.arc(x-9,y-14,11,0,Math.PI*2);ctx.fill();
      ctx.fillStyle="#57934f";ctx.beginPath();ctx.arc(x+9,y-15,10,0,Math.PI*2);ctx.fill();
    } else if (kind === "rock") {
      ctx.fillStyle="#6e7775";ctx.beginPath();
      ctx.moveTo(x-16,y+6);ctx.lineTo(x-11,y-10);ctx.lineTo(x+1,y-16);
      ctx.lineTo(x+15,y-7);ctx.lineTo(x+17,y+7);ctx.lineTo(x+5,y+13);ctx.lineTo(x-11,y+12);
      ctx.closePath();ctx.fill();
      ctx.strokeStyle="#424c49";ctx.lineWidth=2;ctx.stroke();
      ctx.fillStyle="#a8b0a9";ctx.fillRect(x-6,y-7,5,3);ctx.fillRect(x+5,y-1,4,2);
    } else {
      ctx.fillStyle="#376b39";ctx.beginPath();ctx.arc(x,y,13,0,Math.PI*2);ctx.fill();
      ctx.fillStyle="#568d45";ctx.beginPath();ctx.arc(x-7,y-3,8,0,Math.PI*2);ctx.fill();
      ctx.fillStyle="#ba4f50";
      ctx.beginPath();ctx.arc(x-5,y-7,2.6,0,Math.PI*2);ctx.arc(x+7,y-3,2.6,0,Math.PI*2);ctx.arc(x+1,y+7,2.6,0,Math.PI*2);ctx.fill();
    }
    ctx.restore();
    drawEntityHealth(ctx,x,y-25,state);
    return;
  }

  if (entity.entity_type === "obstacle") {
    ctx.fillStyle="#74664c";
    ctx.beginPath();ctx.ellipse(x,y,18,12,0,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle="#403c31";ctx.lineWidth=2;ctx.stroke();
    return;
  }

  if (entity.entity_type === "projectile") {
    const vx=Number(state.vector_x)||0, vy=Number(state.vector_y)||0;
    ctx.save();ctx.translate(x,y);ctx.rotate(Math.atan2(vy,vx));
    ctx.fillStyle=state.projectile_type==="magic"?"#92bfff":"#e4d3a2";
    ctx.beginPath();ctx.moveTo(11,0);ctx.lineTo(-5,-3);ctx.lineTo(-5,3);ctx.closePath();ctx.fill();
    ctx.restore();
    return;
  }

  if (entity.entity_type === "item") {
    const id=String(state.item_id||"");
    const icon=id.includes("sword")?"⚔":id.includes("pickaxe")?"⛏"
      :id.includes("axe")?"🪓":id.includes("bow")||id.includes("arrow")?"🏹"
      :id.includes("shield")?"🛡":id.includes("berries")?"🍓"
      :id.includes("water")?"💧":id.includes("wood")?"🪵"
      :id.includes("stone")?"🪨":id.includes("shirt")||id.includes("armor")?"👕":"◆";
    ctx.save();
    ctx.fillStyle="#2d3527";
    ctx.beginPath();ctx.arc(x,y,11,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle="#d9c38d";ctx.lineWidth=1.5;ctx.stroke();
    ctx.font="13px system-ui";ctx.textAlign="center";ctx.textBaseline="middle";
    ctx.fillStyle="#fff";ctx.fillText(icon,x,y+0.5);
    ctx.restore();
  }
}

function drawEntityHealth(ctx,x,y,state) {
  const health=Number(state?.health);
  const maximum=Number(state?.max_health);
  if(!Number.isFinite(health)||!Number.isFinite(maximum)||maximum<=0) return;
  ctx.fillStyle="#202a21";ctx.fillRect(x-17,y,34,4);
  ctx.fillStyle="#a94840";ctx.fillRect(x-17,y,34*Math.max(0,Math.min(1,health/maximum)),4);
}
