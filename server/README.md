# KTK Authoritative World Server

This service replaces per-movement Postgres RPCs with one persistent WebSocket connection and an in-memory authoritative simulation.

## Runtime model

- Node.js 22, region `gru` (São Paulo).
- Fixed simulation at 30 ticks/second.
- Authoritative world snapshots at 20/second.
- Small movement-intent packets; positions are never accepted from the browser.
- Stale input is stopped after 350 ms.
- Player and world positions are written to Supabase once per second and before a requested flush.
- Supabase Auth validates the player's access token at connection time. The server-only Supabase secret is never sent to a browser or committed to this repository.

Supabase remains responsible for account/session creation, character profiles, inventory/equipment, survival, combat and crown actions. This server owns live movement and collision while players are connected.

## Required environment variables

Set these as Fly secrets, never in source code:

- `SUPABASE_URL`: `https://mtddtvqtljtgzggpdogl.supabase.co`
- `SUPABASE_PUBLISHABLE_KEY`: the existing public `sb_publishable_...` key.
- `SUPABASE_SECRET_KEY`: a new Supabase secret API key for server-to-server database writes. Never use the browser publishable key for writes.

The server sends new Supabase API keys in the `apikey` header. It validates player JWTs separately against `/auth/v1/user`, using the publishable key plus the user's bearer token.

## Deploy

The SQL migration `supabase/migrations/20261117231058_authoritative_websocket_position_sync.sql` must be applied to the Kill the King Supabase project before starting this server.

Install Fly CLI and authenticate, then create the app name if available:

```sh
fly auth login
fly apps create ktk-authoritative-world-uriel29m
fly secrets set \
  SUPABASE_URL="https://mtddtvqtljtgzggpdogl.supabase.co" \
  SUPABASE_PUBLISHABLE_KEY="YOUR_SB_PUBLISHABLE_KEY" \
  SUPABASE_SECRET_KEY="YOUR_SB_SECRET_KEY"
fly deploy
```

If the Fly app name is already taken, choose another name and change both `fly.toml` and `GAME_SERVER_URL` in `online/game-transport.js` to match. The machine is configured to remain running because the world simulation has a continuous tick loop.

## Local development

```sh
cd server
npm install
SUPABASE_URL="..." \
SUPABASE_PUBLISHABLE_KEY="..." \
SUPABASE_SECRET_KEY="..." \
node index.mjs
```

For a local game page, set `window.KTK_GAME_SERVER_URL = "ws://localhost:8080/game"` before `online/game-transport.js` loads, or use the browser developer console before entering the world.

## Test

```sh
cd server
npm install
npm test
```

The tests exercise deterministic simulation, run/walk speeds, diagonal normalization, sequence ordering, stale input expiry and collisions. These are automated code tests; they do not replace a two-browser live network test.
