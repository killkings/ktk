# Kill the King V2 — base isolada

Esta pasta é uma reconstrução paralela. Não é carregada pela V1 e ainda não substitui o jogo publicado.

## Primeiro corte funcional

- Entrada com identidade anônima transitória.
- Personagem criado no Supabase.
- Movimento calculado pelo RPC do servidor.
- Estado recebido por snapshot e Realtime.
- Renderização interpolada exclusivamente para apresentação.
- Sair/Esc encerra o personagem no servidor.
- Sem localStorage, sessionStorage, IndexedDB ou service worker.

A V2 usa tabelas e RPCs `ktk_v2_*`. A migration da V2 deve ser aplicada em ambiente separado ou como adição isolada; ela não pode modificar dados da V1.

## Abrir

Após a publicação de uma branch de teste, a página ficará em `/ktk/v2/`. Na versão atual, abra por um servidor estático na raiz do repositório.

## Testes

Executar `npm test` na raiz. Os testes de `v2/tests` validam regras de apresentação e ordenação das revisões recebidas. As regras de mundo continuam exclusivamente no SQL.

## Escopo ainda não implementado nesta primeira base

Sprites LPC completos, equipamentos, itens, combate, clãs, coroa e mapa de biomas não são considerados prontos apenas por existirem no projeto antigo. Eles serão portados e validados como sistemas próprios, em etapas.
