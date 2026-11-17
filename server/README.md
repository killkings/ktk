# Servidor autoritativo do Kill the King

Este serviço substitui as RPCs PostgreSQL repetidas de movimento por uma conexão WebSocket persistente e uma simulação autoritativa em memória. Ele mantém a versão visual do jogo no GitHub Pages e usa o Supabase para autenticação, perfis, inventário, equipamentos, sobrevivência, combate e persistência.

## Arquitetura

- Node.js 22 em um Render Web Service com Docker.
- Região sugerida: **Virginia (EUA)**. O Render ainda não oferece região no Brasil.
- Simulação fixa a 30 ticks/s; snapshots do mundo a 20/s.
- Navegador envia intenções sequenciadas (inputX, inputY, corrida e defesa), nunca coordenadas finais.
- Movimento e colisões são calculados pelo servidor.
- O cliente prevê a própria apresentação visual e interpola os demais jogadores usando snapshots oficiais.
- Posições são persistidas em lote no Supabase a cada segundo e antes de ações/saída.
- A gravação usa comparação de versão para não sobrescrever knockbacks ou mudanças de posição mais recentes.
- O Supabase Auth valida o token de cada jogador. A chave secreta existe somente no backend.

A morte, a coroa, o combate, inventário e sobrevivência permanecem nas funções autoritativas já existentes do Supabase. Antes de chamar uma dessas ações, o cliente pede ao novo servidor que confirme a posição atual.

## Criar o serviço no Render

Criar um **Web Service** com esta configuração:

| Campo | Valor |
| --- | --- |
| Repositório | https://github.com/killkings/ktk |
| Branch inicial de teste | rebuild/authoritative-websocket-world-20261117 |
| Runtime | Docker |
| Dockerfile | server/Dockerfile |
| Docker context | . (raiz do repositório) |
| Região | Virginia |
| Health check | /healthz |
| Porta | PORT (injetada pelo Render) |
| Origem permitida | https://killkings.github.io |

Para teste inicial entre dois navegadores, pode-se usar o plano gratuito. Ele tem 512 MB de RAM, cota de 750 horas de instância por mês e pode suspender depois de 15 minutos sem tráfego de entrada. O cliente envia uma mensagem WebSocket de manutenção a cada cinco segundos enquanto está conectado. O plano gratuito pode reiniciar a instância; a posição já salva no Supabase permite reconstruí-la após reconexão.

Para uso contínuo sem suspensão, o plano pago menor é o 0.5c-512mb (antigo Starter). Consulte o preço atual no painel antes de mudar o plano.

## Variáveis de ambiente

Configure no painel do Render:

- SUPABASE_URL: https://mtddtvqtljtgzggpdogl.supabase.co
- SUPABASE_PUBLISHABLE_KEY: chave publishable ativa do projeto Kill the King.
- SUPABASE_SECRET_KEY: chave secreta do projeto, gerada em Supabase → Project Settings → API Keys. **Nunca** coloque essa chave no navegador, no Git ou neste README.
- ALLOWED_ORIGINS: https://killkings.github.io

Não é necessário definir PORT: o Render injeta essa variável no processo.

A migration supabase/migrations/20261117231058_authoritative_websocket_position_sync.sql já foi aplicada ao projeto Kill the King. A função de gravação em lote é executável apenas por service_role.

## Endpoints

- HTTP: GET /healthz
- HTTP: POST /leave (autentica o JWT, salva a posição final e encerra o personagem)
- WebSocket: /game

O cliente publicado espera:

    wss://ktk-authoritative-world.onrender.com/game

Caso o nome do serviço precise mudar por indisponibilidade do subdomínio, atualize a URL padrão em online/game-transport.js antes de publicar o cliente.

## Desenvolvimento local

Execute o servidor com as três variáveis Supabase configuradas e PORT=8081. O front-end continua separado no servidor estático que você já usa. Defina window.KTK_GAME_SERVER_URL = ws://localhost:8081/game em um script carregado antes dos módulos online.

## Testes

    cd server
    npm ci
    npm test

Os testes automatizados cobrem simulação determinística, caminhada/corrida, diagonal, sequência de comandos, expiração de input e colisões. Eles não substituem o teste ao vivo com duas contas em dois navegadores.