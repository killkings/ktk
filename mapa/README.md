# Mapa do mundo

`mapa.js` gera e desenha o terreno proceduralmente. O HTML principal o carrega como um arquivo separado. Os tiles sazonais de `LPC-main/Terrain/` são opcionais; quando não estão presentes, o jogo usa o desenho procedural de chão, árvores e flores. Os sprites de personagens, cabelos, esqueletos, armas e equipamentos vêm do repositório oficial Universal LPC por URL fixa, sem cópia dos PNGs no KTK.

## Organização

O mundo começa em uma matriz 3×3 de salas independentes, todas com as mesmas dimensões e proporção 16:9. Os Campos Centrais permanecem intactos na posição central. As oito salas ao redor estão vazias: exibem somente o chão verde, sem vegetação, recursos ou obstáculos. A expansão futura poderá preencher cada uma sem alterar o tamanho das salas nem a posição do mapa central.

Cada tela usa câmera fixa. Ao cruzar uma borda, a câmera muda para a sala vizinha e o personagem reaparece no lado oposto. As coordenadas transmitidas ao servidor e aos outros jogadores são globais, de modo que todos compartilham a mesma posição no mundo mesmo quando estão em salas diferentes. O limite externo da matriz bloqueia a saída do mundo. Os tiles são desenhados em coordenadas globais e usam cache local.

## Integração

O módulo expõe `window.KTKWorldMap.draw(...)`, `regionAt(x, y)`, `bounds` e metadados dos biomas. O HTML desenha a sala atual, muda as coordenadas ao cruzar suas bordas e atualiza o bioma no HUD. Persistência online de objetos/recursos e sincronização entre jogadores continuam como trabalho futuro.
