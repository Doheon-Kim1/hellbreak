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

- clients submit directional, jump, and held rescue intent plus a monotonically increasing sequence number;
- the room derives player ownership from the authenticated connection session instead of accepting a client-supplied player ID;
- clients cannot submit authoritative coordinates;
- stale, replayed, malformed, or non-boolean input is rejected;
- diagonal movement, sprint speed, jump edges, gravity, grounding, route-platform collision, and world bounds are recalculated by the server;
- rising lava, elimination, escape, room phase, and the winner are derived exclusively from server time and authoritative positions;
- on the deadline tick an escape completed that tick wins for the runners, otherwise a non-empty room is a warden win—only an empty room stays in `final-escape` without a winner;
- server ticks are capped at 100 ms to prevent pause-induced teleportation;
- each room is limited to six authenticated players and disconnects remove input ownership immediately;
- room state advances only through the server tick function.

### Authoritative Lava Lifeline

The online room implements one runner-to-runner rescue link without weakening the input boundary:

- the client sends only a held `grab` boolean and never a target ID, coordinate, force, grip, or completion claim;
- the room deterministically selects an eligible airborne or lower teammate inside the validated camera cone and reach;
- each runner may participate in at most one incoming or outgoing link, preventing chains, cycles, and contested multi-grabs;
- the room owns pull/lift force, rescuer counter-drag, grip drain/regeneration, cooldowns, safe-landing completion, and cleanup on release, death, escape, disconnect, restart, or match finish;
- a target near the authoritative lava surface receives a stronger panic pull while grip drain and rescuer drag also increase; rescue never grants lava immunity;
- Colyseus publishes only presentation state (`grabTargetId`, `grabbedById`, normalized `grip`, and `lastAcknowledgedGrab`) for the rope, HUD, and stable test receipts.

### Pointer-lock view and authoritative route ledge grip

Desktop play uses one mutable `CameraOrbit` ref. The centered gameplay button acquires pointer lock only;
subsequent mouse movement writes signed yaw/pitch, and a held primary button writes the same
`grab` intent as the keyboard/mobile fallback. Pointer-lock loss, `mouseup`, blur, visibility loss,
death, and scene cleanup clear the mouse source. Oversized first deltas are rejected while pointer
lock calibrates, so a browser cursor warp cannot become camera input. A held grab latches aim until
release; `C` arms one centered next-grab latch for accessibility and deterministic recovery. Touch
keeps drag-look and the explicit mobile grab button. When pointer lock is unavailable or permission
is denied, the rejection is consumed and the overlay hides; right-drag remains look and left-hold
becomes grab without retrying the denied request.

Movement uses only the yaw-derived XZ forward/right basis. Pitch is clamped for aiming but never
contributes vertical movement. The browser sends `cameraYaw`, `cameraPitch`, and held `grab`; it
never sends a target ID, hit point, glove transform, force, grip value, or mantle result.

Static structure grip is restricted to server-known route platforms:

- `src/game/grip-anchors.ts` creates immutable, stable edge anchors from the same
  `PLAYGROUND_ROUTE` surfaces used by the room simulation;
- an airborne runner holding grab may acquire only a registered anchor after the room validates
  reach, a 3D aim cone, the outward face, and line of sight against every shared platform AABB,
  including the anchor owner's slab so a runner cannot grab or mantle through its underside;
- the room applies capped motion toward the anchor's hang point, drains the existing one-hand grip
  bar, and treats held W as mantle intent rather than ordinary horizontal movement;
- release, range break, exhaustion, death, escape, restart, match finish, or disconnect clears the
  hold; player rescue and structure grip are mutually exclusive;
- Colyseus publishes only `structureGripAnchorId`, which is sufficient for the client to aim the
  articulated glove and show the grip HUD. A rendered glove or client raycast is never evidence of
  gameplay success.

The decorative jungle gym, swings, slides, and moving hazards in `GiantPlayground.tsx` are not yet
part of the room simulation and therefore are deliberately not grabbable. They must first move into
a shared server/client geometry descriptor before authoritative anchors can be added.

#### Rescue balance profile

Every rescue number lives in `src/server/rescue-balance.ts` as one frozen, server-owned profile.
It is imported by `room-simulation.ts` and by room-owned tests only: it is never runtime
configuration, never negotiated with a client, and never bundled for the browser.

The profile is tuned as a **costly save, not free travel**:

| Knob | Value | Intent |
| --- | --- | --- |
| `speedScale` | 0.32 | A linked rescuer keeps under a third of walking speed. |
| `pullSpeed` / `dragSpeed` | 3 / 1.35 | The counter-drag is a large share of the pull, so hauling threatens the rescuer's own footing. |
| `liftAccel` / `maxLiftSpeed` | 26 / 5 | Vertical rescue power is unchanged, with a lower fling ceiling so a haul lands a teammate instead of launching them out of reach. |
| `gripDrainPerSecond` | 0.5 | A full grip is worth about two seconds of holding. |
| `gripRegenPerSecond` | 0.14 | Refilling that bar costs about seven seconds on solid ground. |
| `releaseCooldown` / `exhaustionCooldown` | 1.4 / 3 | Every failed rescue locks out reacquisition; emptying the bar costs more than letting go in time. |
| `panicPullMultiplier` | 1.15 | Panic shortens the "teammate is about to touch lava" window without reversing a lost position. |
| `panicDragMultiplier` / `panicDrainMultiplier` | 1.7 / 2 | The panic band raises cost faster than reward: a desperate hold lasts about one second. |

`reach` (2.4), `breakRange` (3.2), `minDrop` (0.3), `coneDegrees` (75), and `maxStep` (0.5) are
unchanged, so the selection geometry and the per-tick teleport guard keep their existing proofs.
`rescue-balance.test.ts` asserts the design rules rather than the literals: bounded per-tick
displacement, drag/pull ratio, drain-versus-regen ordering, cooldown ordering, and a panic band
that is clutch without being a free reset.

#### Player-facing rescue readout

`src/game/hud.ts` turns the published rescue state into one chip, one banded grip meter, and one
live region:

- states: `idle`, `ready`, `holding`, `held`, `cooldown`, `exhausted`;
- grip bands: `steady`, `warning`, `danger`, with text and a pulse so urgency is never hue-only;
- outcomes: `rescued`, `exhausted`, `lost`, each announced once as a milestone—grip, cooldown
  countdowns, and coordinates never reach the ARIA live region;
- the prompt hides itself during a cooldown or on an empty grip, because the room would refuse.

The outcome set is deliberately narrow. The room publishes no reason for a link ending, and a
range break, the teammate landing, the rescuer losing footing, a death, and a disconnect can all
happen in the same tick, so a cause cannot be recovered from outside. Only two endings are
provable from the snapshot: the teammate finished standing measurably above where the client saw
them caught (`rescued`), and the published grip bar reached empty as the link disappeared, which
is the room's own exhaustion rule and is unreachable any other way while a link is live
(`exhausted`). Everything else—including a link the room made and dropped inside one tick, which
is visible only as the rescue receipt advancing with no link ever published—is reported as `lost`,
a failed rescue with no cause claimed.

#### Rescue rope presentation

The in-scene rope is split so VFX iteration cannot reach gameplay logic:

| Module | Owns |
| --- | --- |
| `src/game/rescue-rope.ts` | whether a link is drawable at all: two distinct named runners, both anchors present and finite, and a span long enough to orient a mesh along |
| `src/game/rescue-rope-visuals.ts` | pure styling math: urgency, grip band, width, colour, pulse, sag/tension, fray, tremor, and the smoothing of published values |
| `src/game/rescue-rope-material.ts` | the Three objects one rope owns for its life, and their disposal |

None of it is authority. The rope reads `grabTargetId`, `grabbedById`, `grip`, and the authoritative
lava height out of the published snapshot and draws them; it never sends anything, so a tampered
client only changes its own picture.

Urgency is deliberately carried on more than hue, because the rope has to read on a stream, on a
phone, and for a colour-blind viewer:

- **lava proximity** drives rope width, pulse *rate*, sag (a slack rope pulls taut as the lava
  closes in), colour, and a banded word on the HUD chip (`구조 중 · 용암 근접` / `· 용암 직전`);
- **rescuer grip** drives fray gaps between strands, a tremor, and a shallow flicker that never
  fades the rope out of sight — independent of lava proximity, so a slipping grip on safe ground and
  a full grip over the lava stay distinguishable;
- the two ends differ by **shape**: a knot on the rescuer, a ring on the runner being hauled up;
- the calm rope stays cyan and the critical rope goes white-hot rather than orange, so it never
  blends into the lava it is being pulled out of;
- `prefers-reduced-motion` stops the pulse and the tremor, and width, tension, fray, colour, and the
  chip still separate every band.

Performance is a hard constraint on mobile, so nothing is rebuilt per frame. Geometry, material, and
the instance buffer are created once per link; a frame writes instance matrices, two endpoint
transforms, and one colour/opacity update, and allocates nothing. The rope is one `InstancedMesh` of
14 unit cylinders plus two markers, and every Three resource is disposed exactly once when the link
unmounts. Published grip and lava height are eased toward their latest values with a frame-rate
independent approach, so a 20 Hz patch stream cannot make the rope step or strobe.

The cooldown countdown is a **client-side mirror**, not published state: the room keeps
`grabCooldownUntil` private and re-decides every tick. The client rebuilds it from milestones it
can already observe—a link disappearing, or the server rescue receipt advancing without a link
ever being published—so the trust boundary is unchanged and a drifted mirror only makes the HUD
optimistic for a frame.

#### Infernal Climber presentation rig

The capsule-only avatar has been replaced visually by an original, primitive-built HELLBREAK
rescue climber: a compact heat suit, broad helmet and visor, chest harness/core, and long jointed
limbs with oversized gloves and boots. It uses no external model or copied character asset. Local,
bot, own-network, and remote-network runners all render through `PlayerCharacter.tsx`; Rapier and
the authoritative room keep their existing capsule collision and movement dimensions underneath.

Animation remains presentation-only:

- `player-character-pose.ts` derives bounded idle, run, jump/fall, landing, rescuing/rescued,
  eliminated, and escaped silhouettes from server-published state plus client-observed render
  velocity; it reuses one mutable output and repairs non-finite inputs;
- `player-character-style.ts` gives each session a stable accent while own, teammate, eliminated,
  and escaped states also differ by helmet ornament and light intensity rather than hue alone;
- the renderer mutates cached joint refs without per-frame React state and shares primitive
  geometry/materials across climbers; reduced-motion lowers gait and bounce without removing the
  readable rescue pose;
- an active rope starts from the rescuer's rendered right glove and ends at the target's harness,
  with the interpolated root as a finite fallback. These anchors are client-local vectors used only
  to draw the rope and are removed on unmount.

No joint, pose, hand position, harness position, target, force, or grip value is added to the room
input or public schema. A modified client can change only its own animation; target selection,
pull/lift, counter-drag, grip, cooldown, landing, and cleanup remain room-owned.

## Implemented Colyseus room adapter

`src/server/hellbreak-room.ts` wraps the transport-independent simulation in a Colyseus room:

- `HellbreakRoomState` and `PlayerSchema` broadcast the authoritative player map;
- room creation and `joinById` use server-issued room and session IDs;
- input messages contain directional booleans, sprint, jump, held rescue, camera yaw, and a monotonic sequence number—never client coordinates, rescue targets, forces, grip, or physics state;
- a 20 Hz server tick advances horizontal and vertical movement against bounds derived from `PLAYGROUND_ROUTE`;
- `HellbreakRoomState` publishes authoritative lava height/phase, match phase/winner, and per-player grounded/alive/escaped state with `x/y/z` and the last processed input sequence;
- clients receive join, movement, and disconnect patches through `@colyseus/sdk`;
- the browser interpolates rendered avatars toward the latest server position.

`src/server/colyseus-server.ts` runs the WebSocket process separately from Next.js on port 2567 and provides `/health`. Development uses `npm run dev` to start both processes. Browser E2E coverage uses two isolated browser contexts for shared movement, authoritative jump/landing, match HUD, and disconnect cleanup. The Lava Lifeline E2E pairs the real browser rescue control with a second real Colyseus room client, then observes the server-selected bidirectional link, pull displacement, grip drain, accepted receipt, and release cleanup without injecting a target or pose.

The current network slice uses deterministic server-side kinematic collision for the fixed climb route rather than running Rapier in the room process. This keeps movement and the Lava Lifeline constraint pure and testable while the client retains Rapier for the credential-free local bot match. Moving platforms, multi-runner rescue chains, items, combat, and full server-side hazard physics remain future slices.

The adapter keeps competitive rules independent from the networking framework and allows the local bot match to remain credential-free.

## Implemented HIVE boundary (Phase 3A)

The server side of identity and matchmaking now exists, behind configuration. Nothing about it
claims a live HIVE connection: no credentials are present, and the routes say so out loud.

### Explicit multiplayer mode split

`src/shared/multiplayer-modes.ts` decides, as pure logic, which online branches may be offered:

- **guest** — the deployed demo. Available whenever a Colyseus address is configured, including on
  the static Pages build. This is the fallback and it is never coupled to HIVE rollout.
- **hive** — the authenticated queue. Closed unless the build, the browser login flow, and the
  server all say it exists, checked in that order so the sentence a player reads is the first thing
  that would actually have to change:
  `static-export` → `login-unwired` → `capability-unknown` → `server-unconfigured`.

The lobby renders both branches always; a closed one is disabled with its reason next to it. No
explanation names an environment variable. `useMultiplayerModes` probes `GET /api/hive/session`
only when a probe could still change the answer, so the Pages build makes no request at all.

### Server boundary

| Module | Owns |
| --- | --- |
| `src/server/hive/config.ts` | Env validation; reports missing/invalid keys **by name only** |
| `src/server/hive/contracts.ts` | The normalized types the rest of the app sees; HIVE payloads stop here |
| `src/server/hive/transport.ts` | The only outbound call: 5 s timeout, 64 KB streaming ceiling, `redirect: 'error'` |
| `src/server/hive/auth.ts` | Authentication v4 token verification, exactly as documented |
| `src/server/hive/matchmaking.ts` | Private Match enqueue/status/cancel, exactly as documented |
| `src/server/hive/allocation.ts` | Where a matched player is told to connect — the seam the match result callback will fill, validated on write against the room token's own id rules |
| `src/server/hive/session.ts` | Signed, HttpOnly, `SameSite=Strict` browser session; carries no access token |
| `src/server/hive/sign-room-token.ts` | The short-lived room join capability |
| `src/server/hive/routes.ts` | The three route handlers as pure functions |

`src/app/api/hive/*/route.ts` are three-line adapters over those factories. Because every one is a
`route.ts` and the Pages build recognises only `.tsx` pages, none of this tree exists in the static
export. A build scan of `out/` confirms no `api/` file, no session cookie name, no signing or crypto
code, and no HIVE upstream URL; the client probe's own URL constant is still in the bundle but is
never requested, because the inlined `NEXT_PUBLIC_STATIC_EXPORT` closes the branch first.

Two rules the routes enforce that are easy to lose later: identity comes from the session cookie and
the room comes from the allocator, so a body field named `playerId` or `roomId` is **rejected**
rather than ignored; and an unconfigured deployment answers `503` with the missing key names instead
of failing open.

Request bodies are bounded by what is actually read, not by what the caller declares. `Content-Length`
is checked first because an honest oversized caller can be refused without touching the socket, but
the body is then pulled a chunk at a time and counted in bytes, the stream is cancelled the moment
it passes 2 KB, and nothing is decoded or parsed before that count is known. A chunked body that
declares no length, or a false one, is refused with `413` without buffering the rest.

Because the allocator's writer is an upstream contract that does not exist yet, an assignment is
checked against the room token's identifier rules **where it is written** and refused by name, and
`/api/hive/room-token` re-checks what it reads back. An unsignable room id is a `409` naming the
broken allocation, never a `500` from the signer. Expiry is decided by an injected clock — the same
one the routes read — and never inferred from the expiry being written, so a long match cannot evict
everyone else's live assignment; an allocation that is already expired when it arrives is refused
rather than stored. Cancelling or re-queueing invalidates the player's assignment **before** HIVE is
called, so an upstream failure cannot leave an abandoned room signable.

### Room join capability

One signing primitive backs both the session cookie and the room capability, with the audience mixed
into the MAC so they can never be swapped. A capability binds four things and the room checks all
four:

| Claim | Enforced by |
| --- | --- |
| identity (`sub`) | one seat per identity in a room |
| assigned room (`room`) | must equal the match the room was claimed for |
| lifetime (`iat`/`exp`) | bounded clock skew, plus a TTL ceiling checked on verification too |
| nonce (`jti`) | single use, in a bounded ledger that fails closed rather than evicting |

`src/server/room-auth.ts` holds the policy; the Colyseus process owns no HIVE credential and makes
no HIVE call. `onCreate` claims a room for one match without spending the creator's nonce, and
`onAuth` then runs the full check for every seat including that one. A room is guest or
authenticated for its whole life: a guest cannot enter a claimed room, and a capability cannot
create a guest one. The HIVE identity stays server-side — published player ids are still Colyseus
session ids.

One seat per identity is claimed in `onAuth`, in the same synchronous step that approves it, rather
than in `onJoin` where the seat actually appears. Colyseus awaits the first callback before calling
the second, so a check written against seated players only would be a check two connections holding
separately minted capabilities for one identity could both pass. Between the two callbacks the
identity is *reserved*: held on a short deadline, promoted to a seat by `onJoin`, released by
`onLeave` and `onDispose`. The deadline is what keeps a connection that dies in that gap — for which
Colyseus never calls `onLeave` — from holding an identity out of its own match indefinitely.

`HELLBREAK_GUEST_JOIN` defaults to `allow` so the live Render demo keeps working; a half-configured
`ROOM_TOKEN_SECRET` stops the process rather than silently downgrading to open joins.

Both hosts read that secret through one function (`readRoomTokenSecret`) and neither normalizes it:
a value with leading or trailing whitespace is refused on both sides instead of being trimmed on
one. Trimming would be the worst of the options available — the room server would report
`authenticatedJoin: true` and then fail the signature of every capability the Next.js host minted,
which reads as a broken token rather than as the environment mistake it is.

Env ownership per host, the official contracts consulted, and the remaining credential blockers are
in [`hive-matchmaking-rollout.md`](hive-matchmaking-rollout.md).

## MVP rollout

The bot-playable local match and static GitHub Pages fallback do not require HIVE credentials. GitHub Pages cannot host the Colyseus WebSocket process, so online controls remain disabled unless a separate `NEXT_PUBLIC_GAME_SERVER_URL` is configured. HIVE integration remains deferred until the HIVE app ID, server API access, and custom web login configuration are available.

## Deployment boundary

The static Next.js export and the realtime room process are deployed separately:

| Artifact | Host | Notes |
| --- | --- | --- |
| Next.js static export | GitHub Pages | `npm run deploy:pages`; `NEXT_PUBLIC_GAME_SERVER_URL` is baked in at build time |
| `src/server/colyseus-server.ts` | Render web service `hellbreak-room` | Declared by `render.yaml`; Singapore, one instance, `/health` health check |

The deployed room server is an **unauthenticated guest demo**, not a production service:

- no identity, no persistence, no leaderboard, no payment, no operational SLA;
- rooms live only in the process memory of a single instance and cannot be distributed;
- a restart, redeploy, or cold start destroys every live room and disconnects its clients;
- `HELLBREAK_ALLOWED_ORIGINS` restricts the browser Origin to the Pages site, which limits ordinary browser embedding but is **not** authentication—non-browser clients can spoof the Origin header.

Short-lived HIVE room join tokens, room-creation rate limiting, durable identity, and production operations are required before a real public launch. The security rules above still apply: no provider credentials are committed, and `render.yaml` carries no secret values.
