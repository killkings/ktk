# Mapa do mundo

Os nove mapas (Campos Centrais e as oito salas ao redor) usam grama desenhada exclusivamente em CSS no fundo do canvas `#world`. A textura combina gradientes repetidos com pequenas lâminas claras e escuras, sem PNG, imagem externa ou dependência de tileset.

O renderizador deixa o piso dessas nove salas transparente para que o padrão CSS apareça. Personagens, sombras, itens e decorações continuam sendo desenhados normalmente por cima. Como o padrão está no canvas principal, ele acompanha a sala exibida durante a navegação pelas nove áreas.

## Organização

O mundo mantém a matriz 3×3 de salas 16:9, com os Campos Centrais na posição central e oito salas externas. Esta alteração muda somente a aparência do chão. Não altera dimensões, limites, movimentação, colisões, coordenadas globais nem lógica de salas.

## Implementação

- Estilo de grama: `css/game.css`, seletor `#world`.
- Transparência do piso: `mapa/mapa.js`, salas `campos` e `vazio`.
- Cache de versão atualizado no HTML principal para recarregar CSS e renderizador.
