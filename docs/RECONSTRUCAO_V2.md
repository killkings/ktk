# Kill the King — reconstrução V2

## Objetivo

Reconstruir o jogo como um RPG 2D de mundo aberto e multiplayer. A V2 é desenvolvida em paralelo; a versão de produção permanece intocada até que a nova versão passe por testes automatizados e testes reais com múltiplos jogadores.

## Requisitos já definidos

- O navegador é somente controle, apresentação e animação. Não é fonte de verdade do mundo.
- Não gravar personagem, identidade, inventário ou sessão em localStorage, sessionStorage, IndexedDB ou service worker. A sessão de autenticação usa memória de página (`persistSession: false`).
- Entrar cria um personagem novo no servidor. Sair da partida ou morrer encerra permanentemente aquele personagem; não se recupera o personagem anterior ao voltar ao criador.
- Posição, direção, colisões, vida, recursos, inventário, equipamentos, combate, projéteis, inimigos, itens no chão e coroa devem ser decididos no servidor.
- Todos os jogadores veem o mesmo mundo e as mesmas posições/ações confirmadas pelo servidor.
- A aparência completa do personagem acompanha o estado do jogador; não pode depender de duas fontes que discordem.
- Personagens LPC devem usar os sprites e animações reais do Universal LPC Spritesheet Character Generator, incluindo frente, costas e lados, sem espelhar uma direção para fingir outra.
- O mundo existe independentemente de qualquer jogador. O terreno deve ser determinístico por coordenadas e expansível em chunks/biomas.
- Existe uma única coroa por mundo. O portador é o rei.
- Clãs são identificados por cores. Jogadores do mesmo clã não podem atacar o próprio rei; jogadores de outros clãs podem.
- Itens e equipamentos usam estado autoritativo do servidor; ações de coletar, largar, equipar, desequipar e consumir precisam ser atômicas.
- O jogo deve manter controles de teclado, combate, progressão e recursos sem executar simulação paralela no navegador.

## Estado da reconstrução

A V2 começa em `/v2` e em tabelas SQL com prefixo `ktk_v2_`. O prefixo separa os novos dados dos dados atuais. Nenhuma tabela, personagem, item, coroa, função, Cron ou configuração da V1 deve ser apagada ou reescrita pela reconstrução.

## Regra de espólio

O comportamento observado na V1 deixa itens no chão após a saída/morte. A V2 deverá tratar os drops como entidades do mundo, com identificador próprio, posição, revisão, coleta atômica e expiração configurável. A política final de espólio será mantida explícita em uma única configuração do servidor, nunca duplicada em código de cliente.

## Arquitetura-alvo

1. **Sessão:** autenticação anônima transitória; o servidor cria um novo personagem por identidade.
2. **Servidor:** RPCs transacionais para entrada, movimento, combate, inventário, coroa e saída.
3. **Mundo:** tabelas para jogadores e entidades; snapshots iniciais e Realtime só transportam alterações do servidor.
4. **Cliente:** envia intenção de controle; mantém cópias temporárias em RAM para desenhar; nunca grava ou decide o estado.
5. **Renderização:** câmera, interpolação visual e animação são apresentação. Não alteram coordenadas nem regras.
6. **Sprites:** catálogo LPC versionado, carregamento validado por camada/direção/ação, fallback visual explícito e repetição de carregamento sem congelar aparência incompleta.

## Ordem de implementação

- [x] Criar trilha de reconstrução isolada, sem alterar a V1.
- [ ] Base V2: entrada/saída, sessão transitória, snapshots, Realtime e movimento autoritativo.
- [ ] Teste real com dois navegadores: posição, direção, colisão, entrada e saída.
- [ ] Criador e renderizador LPC: mesmas camadas e cores para local e remotos, quatro direções e animações.
- [ ] Entidades persistentes: recursos, inimigos, drops, coleta e expiração.
- [ ] Combate: ataque corpo a corpo, dano, knockback, projéteis e morte no servidor.
- [ ] Inventário/equipamento: ações atômicas, durabilidade e atributos efetivos.
- [ ] Clãs por cor e regra de combate entre clãs.
- [ ] Coroa única, reivindicação/queda/recuperação e sincronização global.
- [ ] Mundo por chunks e biomas, com simulação independente da presença de um jogador.
- [ ] Desconexão: saída explícita e fechamento de página encerram personagem; suspensão de aba não causa morte indevida.
- [ ] Teste de regressão, carga básica e publicação gradual.

## Portas obrigatórias antes de substituir a V1

- Testes unitários e SQL de invariantes passando.
- Dois ou mais clientes reais veem a mesma posição, aparência, dano, drops e coroa.
- Atualização atrasada não reverte estado novo.
- Um personagem não pode continuar vivo após saída confirmada.
- Uma segunda entrada gera identidade/personagem novos.
- Nenhum estado persistente do jogo é escrito no navegador.
- O jogo continua operável após recarregar a página, perda de rede e reconexão, obedecendo à regra de morte definida.
- Nenhuma alteração destrutiva nos dados V1.
