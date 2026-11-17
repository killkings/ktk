// Item de cenário fixo próximo ao ponto inicial do jogador.
(() => {
  'use strict';

  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = window.KTKLPC_CONFIG.spritesRoot + 'weapon/sword/longsword/attack_thrust/behind/longsword.png';

  const sword = {
    id: 'longsword-1',
    type: 'item',
    itemType: 'sword',
    displayName: 'Longsword',
    collected: false,
    attackBonus: 10,
    range: 1.5,
    staminaCost: 8,
    attackInterval: 1.0,
    durability: 150,
    maxDurability: 150,
    // Coordenada mundial na sala inicial; o terreno e as árvores são desenhados antes do item.
    x: 8,
    y: 38,
    radius: 10,
    image,
    frameWidth: 64,
    frameHeight: 64,
    // Quarta espada visível na primeira fileira da folha (coluna 10, linha 1).
    sourceX: 640,
    sourceY: 64,
    displaySize: 64
  };

  function draw(ctx, screenX, screenY) {
    if (!image.complete || !image.naturalWidth) return;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    // A primeira linha da folha está vazia; a espada aparece na terceira linha (direção para baixo).
    ctx.translate(screenX, screenY);
    const half = sword.displaySize / 2;
    ctx.drawImage(
      image,
      sword.sourceX, sword.sourceY, sword.frameWidth, sword.frameHeight,
      -half, -half, sword.displaySize, sword.displaySize
    );
    ctx.restore();
  }

  window.KTKWorldSword = { entity: sword, draw };
})();
