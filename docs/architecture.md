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
- the room derives player ownership from the authenticated connection session instead of accepting a client-supplied player ID;
- clients cannot submit authoritative coordinates;
- stale, replayed, malformed, or non-boolean input is rejected;
- diagonal movement and sprint speed are recalculated by the server;
- server ticks are capped at 100 ms to prevent pause-induced teleportation;
- each room is limited to six authenticated players and disconnects remove input ownership immediately;
- room state advances only through the server tick function.

## Implemented Colyseus room adapter

`src/server/hellbreak-room.ts` wraps the transport-independent simulation in a Colyseus room:

- `HellbreakRoomState` and `PlayerSchema` broadcast the authoritative player map;
- room creation and `joinById` use server-issued room and session IDs;
- input messages contain directional booleans, sprint, camera yaw, and a monotonic sequence number—never client coordinates;
- a 20 Hz server tick advances the simulation and publishes `x/y/z` plus the last processed input sequence;
- clients receive join, movement, and disconnect patches through `@colyseus/sdk`;
- the browser interpolates rendered avatars toward the latest server position.

`src/server/colyseus-server.ts` runs the WebSocket process separately from Next.js on port 2567 and provides `/health`. Development uses `npm run dev` to start both processes. Browser E2E coverage creates two isolated contexts, joins them to one room, moves one participant, observes the movement from the other, and verifies disconnect cleanup.

The current network slice deliberately synchronizes only horizontal `x/z` movement. The server keeps `y` at its assigned spawn height until server-side Rapier collision and vertical movement are introduced. This prevents the browser from becoming authoritative over jump or climb coordinates.

The adapter keeps competitive rules independent from the networking framework and allows the local bot match to remain credential-free.

## MVP rollout

The bot-playable local match does not require HIVE credentials. HIVE integration starts when the HIVE app ID, server API access, and custom web login configuration are available.
