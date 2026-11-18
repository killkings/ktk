# Mapa do mundo

Os nove mapas (Campos Centrais e as oito salas ao redor) usam grama desenhada em CSS no fundo do canvas `#world`. Cada sala tem um padrão próprio, identificado por sua posição na matriz 3×3: muda o tom do gramado, a distribuição de tufos, a escala e a orientação das lâminas.

O mapa central preserva o padrão principal de pradaria. Os oito vizinhos usam variações próprias de gramado, mas todos continuam sendo campos de grama, sem depender de PNG ou carregamento externo. Personagens, sombras, itens e decorações permanecem em primeiro plano.

## Organização

O mundo mantém a matriz 3×3 de salas 16:9, com os Campos Centrais na posição central e oito salas externas. Esta alteração muda somente a aparência do chão. Não altera dimensões, limites, movimentação, colisões ou coordenadas globais.

## Implementação

- Padrões visuais: `css/game.css`, seletores `#world[data-grass-room]`.
- Identificação da sala ativa: `mapa/mapa.js`, atributo `data-grass-room` com valores de `0-0` a `2-2`.
- Cache de versão atualizado no HTML principal.
