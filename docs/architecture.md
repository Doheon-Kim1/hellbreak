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

- clients submit directional and jump intent plus a monotonically increasing sequence number;
- the room derives player ownership from the authenticated connection session instead of accepting a client-supplied player ID;
- clients cannot submit authoritative coordinates;
- stale, replayed, malformed, or non-boolean input is rejected;
- diagonal movement, sprint speed, jump edges, gravity, grounding, route-platform collision, and world bounds are recalculated by the server;
- rising lava, elimination, escape, room phase, and the winner are derived exclusively from server time and authoritative positions;
- on the deadline tick an escape completed that tick wins for the runners, otherwise a non-empty room is a warden win—only an empty room stays in `final-escape` without a winner;
- server ticks are capped at 100 ms to prevent pause-induced teleportation;
- each room is limited to six authenticated players and disconnects remove input ownership immediately;
- room state advances only through the server tick function.

## Implemented Colyseus room adapter

`src/server/hellbreak-room.ts` wraps the transport-independent simulation in a Colyseus room:

- `HellbreakRoomState` and `PlayerSchema` broadcast the authoritative player map;
- room creation and `joinById` use server-issued room and session IDs;
- input messages contain directional booleans, sprint, jump, camera yaw, and a monotonic sequence number—never client coordinates or physics state;
- a 20 Hz server tick advances horizontal and vertical movement against bounds derived from `PLAYGROUND_ROUTE`;
- `HellbreakRoomState` publishes authoritative lava height/phase, match phase/winner, and per-player grounded/alive/escaped state with `x/y/z` and the last processed input sequence;
- clients receive join, movement, and disconnect patches through `@colyseus/sdk`;
- the browser interpolates rendered avatars toward the latest server position.

`src/server/colyseus-server.ts` runs the WebSocket process separately from Next.js on port 2567 and provides `/health`. Development uses `npm run dev` to start both processes. Browser E2E coverage creates two isolated contexts, joins them to one room, observes shared movement, authoritative jump/landing and match HUD state, and verifies disconnect cleanup.

The current network slice uses deterministic server-side kinematic collision for the fixed climb route rather than running Rapier in the room process. This keeps the competitive rules pure and testable while the client retains Rapier for the credential-free local bot match. Moving platforms, grab/pull constraints, items, combat, and full server-side hazard physics remain future slices.

The adapter keeps competitive rules independent from the networking framework and allows the local bot match to remain credential-free.

## MVP rollout

The bot-playable local match and static GitHub Pages fallback do not require HIVE credentials. GitHub Pages cannot host the Colyseus WebSocket process, so online controls remain disabled unless a separate `NEXT_PUBLIC_GAME_SERVER_URL` is configured. HIVE integration and public room hosting start when the HIVE app ID, server API access, custom web login configuration, and a protected dedicated server environment are available.
