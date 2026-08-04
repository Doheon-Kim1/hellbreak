# HELLBREAK MVP architecture

## Request flow

1. The browser opens the Next.js app on Vercel.
2. Next.js starts a HIVE custom web login flow and keeps HIVE secrets server-side.
3. The backend validates the HIVE Auth v4 token and creates an HELLBREAK session.
4. A player requests a queue ticket through HIVE Matchmaking.
5. The match allocator selects a dedicated Colyseus room.
6. The browser joins that room with a short-lived room token.
7. Colyseus owns all competitive game state and submits final results to HIVE Leaderboard/Analytics.

## Responsibility matrix

| Capability | Owner |
| --- | --- |
| Pages, lobby UI, session bootstrap | Next.js |
| Player identity and token verification | HIVE Auth v4 |
| Queue and room allocation metadata | HIVE Matchmaking |
| Frame-by-frame simulation | Colyseus |
| Physics validation and anti-cheat | Colyseus |
| Leaderboard and operational analytics | HIVE |
| 3D rendering and prediction | Browser client |

## Security rules

- Never expose HIVE server keys to the browser.
- Verify HIVE tokens from server-side code before issuing a Colyseus room token.
- Use short-lived, single-room join tokens.
- Treat all client movement and ability commands as untrusted input.
- Do not commit provider credentials; inject them through deployment environment variables.

## Implemented authoritative foundation

The transport-independent room simulation now lives in `src/server/room-simulation.ts`.
It already enforces the core Room Host boundary:

- clients submit directional input plus a monotonically increasing sequence number;
- clients cannot submit authoritative coordinates;
- stale or replayed input is rejected;
- diagonal movement and sprint speed are recalculated by the server;
- room state advances only through the server tick function.

The upcoming Colyseus adapter will translate room messages into these tested commands and broadcast the resulting snapshots. This keeps competitive rules independent from the networking framework and allows the local bot match to remain credential-free.

## MVP rollout

The bot-playable local match does not require HIVE credentials. HIVE integration starts when the HIVE app ID, server API access, and custom web login configuration are available.
