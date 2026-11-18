# Mapa do mundo

`mapa.js` desenha o mundo em salas independentes 16:9. O **mapa central (Campos Centrais)** usa o terreno de verão de Eliza Wyatt (DeathsDarling) e Lanea Zimmerman (Sharm), armazenado localmente em `mapa/assets/lpc-terrain-summer.png`. As flores de chão usam `wildflowers_summer.png` da mesma revisão LPC, carregada de uma URL fixa do repositório original. O renderizador aplica o terreno LPC às células centrais, mantém variação de capim e distribui flores em posições determinísticas.

As oito salas externas ficam fora do escopo desta alteração e serão tratadas separadamente. Esta mudança não altera o layout do mundo, as dimensões das salas, a movimentação, as colisões nem os Campos Centrais em relação à posição no mapa.

## Integração

O HTML principal carrega `mapa/mapa.js`. O módulo expõe `window.KTKWorldMap.draw(...)`, `regionAt(x, y)`, `bounds` e metadados dos biomas. Quando os arquivos LPC são carregados, o módulo limpa os caches de tiles e salas para reconstruir o mapa com a arte.

## Créditos do terreno central

- Terreno: [terrain_summer.png](https://github.com/ElizaWy/LPC/blob/f07f7f5892e67c932c68f70bb04472f2c64e46bc/Terrain/terrain_summer.png).
- Autoria: grama, terra e águas rasas originais por Lanea Zimmerman (Sharm); edição, animação e recoloração por Eliza Wyatt (DeathsDarling).
- Flores: [wildflowers_summer.png](https://github.com/ElizaWy/LPC/blob/f07f7f5892e67c932c68f70bb04472f2c64e46bc/Terrain/wildflowers_summer.png), flores originais por Lanea Zimmerman; reconfiguradas e recoloridas por Eliza Wyatt.
- Licença: OGA-BY 3.0. Consulte [Terrain/Credits.txt](https://github.com/ElizaWy/LPC/blob/f07f7f5892e67c932c68f70bb04472f2c64e46bc/Terrain/Credits.txt).

