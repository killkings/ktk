# Ferramentas LPC

## Regenerar o catálogo de personagens

Na raiz do repositório, execute:

```bash
node tools/gerar_catalogo_lpc.mjs
```

O script mantém `personagem.js` como arquivo gerado. Não edite cabelos, barbas, bigodes, camadas ou paletas diretamente nele.

A fonte é fixada pela revisão declarada em `js/lpc-config.js`, que também define a URL-base usada pelo jogo. Se a pasta local `Universal-LPC-Spritesheet-Character-Generator-master` não estiver no commit exato, o script prepara uma cópia temporária da fonte oficial usando Git, baixa somente `sheet_definitions`, `spritesheets/hair` e `spritesheets/beards`, e remove a cópia temporária ao terminar.

Para apontar explicitamente para outro checkout local da mesma revisão, defina `KTK_LPC_SOURCE_DIR`.
