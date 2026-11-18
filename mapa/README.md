# Mapa do mundo

`mapa.js` gera e desenha o terreno em salas. O HTML principal o carrega como um arquivo separado. As oito salas externas usam uma amostra de grama LPC retirada de `ElizaWy/LPC/Terrain/terrain_summer.png`, armazenada localmente em `mapa/assets/lpc-terrain-summer.png`; a textura é exclusiva dessas salas e não altera os Campos Centrais. Os outros tiles sazonais de `LPC-main/Terrain/` continuam opcionais. Os sprites de personagens, cabelos, esqueletos, armas e equipamentos vêm do repositório oficial Universal LPC por URL fixa, sem cópia dos PNGs no KTK.

## Organização

O mundo começa em uma matriz 3×3 de salas independentes, todas com as mesmas dimensões e proporção 16:9. Os Campos Centrais permanecem intactos na posição central. As oito salas ao redor exibem um piso de grama texturizado com arte LPC, sem vegetação alta, recursos ou obstáculos. A expansão futura poderá preencher cada uma sem alterar o tamanho das salas nem a posição do mapa central.

Cada tela usa câmera fixa. Ao cruzar uma borda, a câmera muda para a sala vizinha e o personagem reaparece no lado oposto. As coordenadas transmitidas ao servidor e aos outros jogadores são globais, de modo que todos compartilham a mesma posição no mundo mesmo quando estão em salas diferentes. O limite externo da matriz bloqueia a saída do mundo. Os tiles são desenhados em coordenadas globais e usam cache local.

## Integração

O módulo expõe `window.KTKWorldMap.draw(...)`, `regionAt(x, y)`, `bounds` e metadados dos biomas. O HTML desenha a sala atual, muda as coordenadas ao cruzar suas bordas e atualiza o bioma no HUD. Persistência online de objetos/recursos e sincronização entre jogadores continuam como trabalho futuro.


## Crédito da grama LPC

- Arquivo de origem: [terrain_summer.png](https://github.com/ElizaWy/LPC/blob/f07f7f5892e67c932c68f70bb04472f2c64e46bc/Terrain/terrain_summer.png)
- Autoria: grama original de Lanea Zimmerman (Sharm); edição, animação e recoloração por Eliza Wyatt (DeathsDarling).
- Licença: OGA-BY 3.0.
- Arte de origem: [Liberated Pixel Cup LPC Base Assets — Sprites & Map Tiles](https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles).
- Créditos detalhados: [Terrain/Credits.txt](https://github.com/ElizaWy/LPC/blob/f07f7f5892e67c932c68f70bb04472f2c64e46bc/Terrain/Credits.txt).
