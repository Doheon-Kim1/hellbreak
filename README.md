# HELLBREAK

Browser-first 3D asymmetric multiplayer game for **OpenAI Game Builders Seoul 2026**.

> One Hell Warden hunts 3–5 runners through a vertical prison while lava rises. Runners create soul echoes to mislead the Warden or sacrifice echoes into the lava to form temporary platforms.

## MVP stack

- Next.js 16 App Router, React 19, TypeScript
- Three.js, React Three Fiber, Drei
- Rapier physics and Zustand client state
- Colyseus authoritative real-time game rooms
- Com2uS HIVE for web authentication, matchmaking, leaderboard, chat, and analytics
- Vitest unit tests and Playwright browser tests
- Vercel for the Next.js app; dedicated WebSocket host for Colyseus

## Commands

```bash
npm install
npm run dev
npm test
npm run lint
npm run build
npm start
```

Open `http://localhost:5173` after starting the development server.

## MVP scope

1. One vertical prison map and rising lava
2. One Warden, three runner bots, human can choose either role
3. Movement, jump, dash, capture, rescue
4. Soul Echo decoy and lava-platform conversion
5. Three seals, final escape door, four-minute match, instant rematch
6. Local bot match first; authoritative online room second

## Backend boundaries

- **Next.js:** web UI, secure HIVE server-side integration routes, session bootstrap
- **HIVE:** identity/token verification, matchmaking ticketing, leaderboard, chat, analytics
- **Colyseus:** authoritative match clock, movement validation, lava, captures, seals, victory

HIVE matchmaking chooses or allocates a room, but HIVE database/API events are not used as the frame-by-frame transport. The browser connects directly to the allocated Colyseus WebSocket room after its HIVE token is verified server-side.

See [`docs/architecture.md`](docs/architecture.md) for the integration flow.
