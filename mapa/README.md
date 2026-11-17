# Mapa do mundo

`mapa.js` gera e desenha o terreno localmente. O HTML principal o carrega como um arquivo separado. Os chãos, árvores e flores vêm das folhas sazonais em `LPC-main/Terrain/`; os arquivos são lidos da cópia local.

## Organização

O mundo é uma matriz de mapas independentes, um por tela. Cada coordenada tem um bioma e uma sub-região determinísticos. Os Campos Centrais ficam no centro, ladeados por uma faixa irregular de Águas Quentes; florestas, pântanos, desertos, savanas, selvas, taiga e terras congeladas ocupam regiões vizinhas, com o Oceano Polar ao norte. O castelo central está reservado para uma etapa posterior.

Cada tela tem proporção 16:9 e usa câmera fixa. As salas ocupam células adjacentes numa grade: a coordenada da câmera escolhe a sala, e cruzar uma borda muda para a sala vizinha e posiciona o jogador no lado oposto. O layout macro usa uma matriz irregular; a mesma coordenada sempre produz o mesmo terreno e sub-região. Os tiles são desenhados em coordenadas globais, sem recorte nos limites da sala inicial, e usam cache local. Estradas, pontes e travessias ainda precisam ser incluídas para garantir continuidade visual e navegação entre mapas.

## Integração

O módulo expõe `window.KTKWorldMap.draw(...)`, `regionAt(x, y)`, `bounds` e metadados dos biomas. O HTML desenha a sala atual, muda as coordenadas ao cruzar suas bordas e atualiza o bioma no HUD. Persistência online de objetos/recursos e sincronização entre jogadores continuam como trabalho futuro.
