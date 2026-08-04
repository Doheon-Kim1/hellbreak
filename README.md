# HELLBREAK

Browser-first 3D asymmetric multiplayer game for **OpenAI Game Builders Seoul 2026**.

> One Hell Warden hunts 3–5 runners through a vertical prison while lava rises. Runners create soul echoes to mislead the Warden or sacrifice echoes into the lava to form temporary platforms.

## MVP stack

- React 19, TypeScript, Vite 8
- Three.js, React Three Fiber, Drei
- Rapier physics
- Zustand client state
- Colyseus authoritative multiplayer server (next milestone)
- Vitest unit tests and Playwright browser tests
- Vercel static client deployment; dedicated WebSocket host for Colyseus
- Supabase later for accounts, match history, and analytics—not authoritative gameplay

## Commands

```bash
npm install
npm run dev
npm test
npm run build
npm run preview
```

Open `http://localhost:5173` after starting the dev server.

## MVP scope

1. One vertical prison map and rising lava
2. One Warden, three runner bots, human can choose either role
3. Movement, jump, dash, capture, rescue
4. Soul Echo decoy and lava-platform conversion
5. Three seals, final escape door, four-minute match, instant rematch
6. Local bot match first; authoritative online room second

## Architecture rule

The client renders and predicts movement. The Colyseus server owns match time, lava height, captures, seals, and victory. Never use Supabase database events as the frame-by-frame game transport.
