# Kill the King V2 — reconstrução isolada

A V2 é uma reconstrução paralela do jogo. Ela não substitui a V1 publicada e não escreve nas tabelas `ktk_*` da versão antiga. As migrations usam tabelas e RPCs `ktk_v2_*`; a versão nova ainda não foi aplicada ao projeto Supabase de produção nem publicada no GitHub Pages principal.

## Regras já portadas para o núcleo do servidor

- Uma identidade anônima nova por personagem; o cliente não persiste sessão, inventário, equipamentos ou posição no navegador.
- O servidor cria o personagem, define posição/direção, valida movimento/colisão e transmite revisões por Realtime.
- Morte, saída explícita e expiração de uma sessão realmente abandonada encerram o personagem permanentemente.
- Ao morrer/sair/desconectar, inventário e equipamentos viram espólio no chão. Outros jogadores podem coletar; os itens expiram pelo relógio do mundo (15 minutos por padrão).
- A aba oculta ou colocada no cache de navegação pausa a personagem, em vez de matá-la. Ao voltar, a mesma sessão é retomada. Eventos de visibilidade antigos não podem desfazer uma retomada mais nova.
- O mundo tem entidades persistentes compartilhadas: coroa única, recursos colhíveis, obstáculos, esqueletos, itens e projéteis.
- O servidor valida clãs, proteção do Rei por membros do próprio clã, combate corpo a corpo, escudos, flechas, magia, bumerangues, durabilidade, fome, sede, estamina, regeneração e espólio.
- O cliente apenas envia intenções e desenha snapshots. A interpolação é visual; não altera posição autoritativa.

## Aparência

A V2 usa o catálogo de cabelos e os sprites Universal LPC já usados pelo repositório. Jogador local e remoto passam pelo mesmo carregador de camadas. Quando uma camada falha, a representação temporária continua vestida e o carregador tenta novamente; uma aparência parcial não substitui silenciosamente uma aparência completa anterior.

## Abrir

Depois de a branch de teste ser publicada, a página ficará em `/ktk/v2/`. Antes disso, pode ser aberta com um servidor estático na raiz do repositório. A versão atual não é a publicação oficial do jogo.

## Validação

Na raiz do repositório:

```bash
npm test
```

O GitHub Actions também cria um PostgreSQL descartável, aplica todas as migrations V2 em ordem e executa testes integrados de entrada, movimento, inventário, equipamentos, clãs, coroa, combate, projéteis, simulação, suspensão, desconexão e espólio.

A suíte não substitui um teste manual com dois navegadores reais. A V2 só deve avançar para publicação após a suíte completa passar e o multiplayer real ser verificado com duas contas separadas.
