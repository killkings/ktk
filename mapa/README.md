# Mapa do mundo

`mapa.js` gera e desenha o terreno proceduralmente. O HTML principal o carrega como um arquivo separado. Os tiles sazonais de `LPC-main/Terrain/` são opcionais; quando não estão presentes, o jogo usa o desenho procedural de chão, árvores e flores. Os sprites de personagens, cabelos, esqueletos, armas e equipamentos vêm do repositório oficial Universal LPC por URL fixa, sem cópia dos PNGs no KTK.

## Organização

O mundo é uma matriz de mapas independentes, um por tela. Cada coordenada tem um bioma e uma sub-região determinísticos. Os Campos Centrais ficam no centro, ladeados por uma faixa irregular de Águas Quentes; florestas, pântanos, desertos, savanas, selvas, taiga e terras congeladas ocupam regiões vizinhas, com o Oceano Polar ao norte. O castelo central está reservado para uma etapa posterior.

Cada tela tem proporção 16:9 e usa câmera fixa. As salas ocupam células adjacentes numa grade: a coordenada da câmera escolhe a sala, e cruzar uma borda muda para a sala vizinha e posiciona o jogador no lado oposto. O layout macro usa uma matriz irregular; a mesma coordenada sempre produz o mesmo terreno e sub-região. Os tiles são desenhados em coordenadas globais, sem recorte nos limites da sala inicial, e usam cache local. Estradas, pontes e travessias ainda precisam ser incluídas para garantir continuidade visual e navegação entre mapas.

## Integração

O módulo expõe `window.KTKWorldMap.draw(...)`, `regionAt(x, y)`, `bounds` e metadados dos biomas. O HTML desenha a sala atual, muda as coordenadas ao cruzar suas bordas e atualiza o bioma no HUD. Persistência online de objetos/recursos e sincronização entre jogadores continuam como trabalho futuro.
