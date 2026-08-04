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

## MVP rollout

The bot-playable local match does not require HIVE credentials. HIVE integration starts when the HIVE app ID, server API access, and custom web login configuration are available.
