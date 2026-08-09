# HIVE identity and matchmaking rollout

Phase 3A built the server boundary, the signed room join capability, and the explicit mode split.
Nothing in this document claims a working HIVE connection: no credentials are present in this
repository or in any environment it has been run in, and the parts that cannot be verified from
public documentation are listed as blockers rather than guessed at.

## Topology

Three deployments, three different trust levels.

| Artifact | Host | Role |
| --- | --- | --- |
| Next.js static export | GitHub Pages | **Guest fallback only.** No server routes exist in this build. |
| Next.js server build | Vercel (planned) | Owns HIVE secrets, verifies identity, queues, and signs room join capabilities. |
| `src/server/colyseus-server.ts` | Render `hellbreak-room` | Authoritative simulation. Verifies capabilities; owns no HIVE credential. |

The static export cannot host any of this. `next.config.ts` sets `pageExtensions: ['tsx']` for
`GITHUB_PAGES=true`, so the whole `src/app/api` tree (every file is `route.ts`) is absent from the
Pages build rather than being made request-independent. `npm run build` with `GITHUB_PAGES=true`
emits `/` and `/_not-found` only, and `out/` holds no `api/` file at all: no route handler, no
session cookie name, no signing or crypto code, and no HIVE upstream URL. The one remaining trace is
the client probe's own URL constant (`/hellbreak/api/hive/session`) inside the bundle, which is never
requested — `NEXT_PUBLIC_STATIC_EXPORT` is inlined as `true`, so the branch closes before any probe.

## Environment ownership

Nothing below is committed. Values are injected per host.

### Next.js server host (Vercel) — required for the authenticated path

| Key | Purpose | Notes |
| --- | --- | --- |
| `HIVE_APP_ID` | `appid` in the Auth v4 verification body | From the Hive Console |
| `HIVE_SERVER_API_KEY` | `Authorization: Bearer` for the Matchmaking API | **Secret.** Never leaves the server |
| `HIVE_AUTH_BASE_URL` | Origin only, e.g. `https://sandbox-auth.qpyou.cn` | Path is appended by the adapter |
| `HIVE_MATCHMAKING_BASE_URL` | Origin only, e.g. `https://sandbox-api-match.withhive.com` | Path is appended by the adapter |
| `HIVE_GAME_INDEX` | `gameIndex` path parameter | Positive integer from the Console |
| `HIVE_MATCH_ID` | `matchId` path parameter | Positive integer from the Console |
| `ROOM_TOKEN_SECRET` | Signs session cookies and room capabilities | **Secret**, ≥ 32 characters, **no leading or trailing whitespace** |
| `NEXT_PUBLIC_APP_ORIGIN` | Origin check and cookie `Secure` decision | Public |

`readHiveConfig` validates every one of them and reports failures **by key name only**. A partially
configured deployment answers `503 hive_not_configured` with those names; it never half-works.

### Room server host (Render) — governs who may take a seat

| Key | Default | Purpose |
| --- | --- | --- |
| `ROOM_TOKEN_SECRET` | unset | Must be byte-identical to the Next.js host's value. Unset means this deployment cannot verify any capability and refuses every token. |
| `HELLBREAK_GUEST_JOIN` | `allow` | `allow` keeps the current public demo working; `deny` closes it. Any other value stops the process. |
| `ROOM_TOKEN_CLOCK_SKEW_MS` | `5000` | Tolerated clock difference between the two hosts. |
| `HELLBREAK_ALLOWED_ORIGINS` | local dev origins | Browser Origin allowlist. Not authentication. |

The default is `allow` deliberately: the live Render service **is** the guest demo, and this slice
must not disconnect it. Production flips it to `deny` once the authenticated path is real.
`/health` reports `guestJoin` and `authenticatedJoin` booleans so the posture is checkable without
reading the environment.

**`ROOM_TOKEN_SECRET` is read identically by both hosts and normalized by neither.** One function,
`readRoomTokenSecret`, decides for the Next.js config and the room policy alike: at least 32
characters, and no leading or trailing whitespace. A value pasted with a trailing newline is
therefore refused on *both* sides — the Next.js host lists `ROOM_TOKEN_SECRET` as a blocker and
answers `503`, the room server throws on start — instead of one host silently trimming it, reporting
`authenticatedJoin: true`, and then failing the signature of every capability the other host mints.
Whitespace inside the value is part of the key, so a passphrase is a valid secret.

### Browser build flags

| Key | Meaning |
| --- | --- |
| `NEXT_PUBLIC_STATIC_EXPORT` | Set to `true` by `next.config.ts` for the Pages build. Closes the HIVE branch with the "static build" explanation. |
| `NEXT_PUBLIC_HIVE_LOGIN` | Reserved. The browser queue client (Task 11) sets it to `enabled` when it ships. Setting it today only changes which honest explanation appears. |
| `NEXT_PUBLIC_GAME_SERVER_URL` | Colyseus address for the guest demo. Unchanged. |

## Official documentation consulted

Both implemented adapters follow published contracts exactly; no endpoint or field was invented.

- **Authentication v4 token verification** —
  <https://developers.hiveplatform.ai/en/latest/api/hive-server-api/web-login/integration/verify-token-user-info/>
  `POST {authBaseUrl}/game/token/get-token`, headers `Authorization` and `ISCRYPT: 0`, body
  `{ appid, did, player_id }`, response `{ result_code, result_msg }` with `0` meaning success.
- **Matchmaking Private Match API** —
  <https://developers.hiveplatform.ai/en/latest/api/matchmaking-api/private-api/>
  `POST`/`GET`/`DELETE` on
  `{base}/gameindexes/{gameIndex}/matchmakings/{matchId}/players`, `Authorization: Bearer`, request
  score range 0–999,999,999, statuses `requestingStatus ∈ {requested, notRequested}` and
  `matchingInfo.status ∈ {matchingInProgress, timeout, matched}`.

Two consequences of the documented contracts are worth stating plainly:

1. The verification response carries **no profile**. The identity the adapter returns is the
   `(PlayerID, DID)` pair the browser claimed and HIVE just confirmed belongs to the presented
   token. That is the entire security value: the browser may claim anything, and HIVE is what
   refuses it.
2. The queue responses carry **no room id, session id, or server address**. HIVE delivers those
   through a separate match result callback to the game server.

## Blockers before this path can be switched on

| # | Blocker | Effect today |
| --- | --- | --- |
| 1 | No HIVE app credentials (`HIVE_APP_ID`, `HIVE_SERVER_API_KEY`, game/match indices) | Every route answers `503 hive_not_configured`. No HIVE request has ever been made. |
| 2 | **Match result callback contract is not publicly documented** | `MatchAllocationStore` is the seam it will write into. It is empty, so `/api/hive/room-token` answers `409 match_not_allocated` even for a matched player. This is the one contract that had to be left unimplemented rather than guessed. `record()` validates what it is handed and returns a named refusal, so the callback adapter learns its payload is unusable at the write. |
| 2a | **Late-callback correlation is blocked by the same gap** | Cancelling or re-queueing invalidates the player's assignment immediately, so a stale room can no longer be signed after the attempt that produced it ended. What cannot be built yet is the other direction: a callback that lands *after* the cancel, for the attempt that was cancelled, is indistinguishable from a callback for the attempt that replaced it. Correlating them needs a queue/ticket identifier in the callback payload, and no such field is documented — inventing one would be a guess in the security path. Until the real contract is known, the window is "a callback for an abandoned attempt may allocate a room the player then legitimately joins"; it closes when step 2 of the rollout is implemented against the published payload. |
| 3 | No HIVE web login in the browser | `NEXT_PUBLIC_HIVE_LOGIN` stays unset, so the lobby closes the branch with "this build has no login". Task 11. |
| 4 | No Vercel deployment or Vercel CLI in this environment | The authenticated path has never been exercised against a real origin. |
| 5 | `HIVE_CALLBACK_URL` intentionally unread | Adding it to the required set would demand configuration for a route that does not exist yet. It appears here, not in `config.ts`. |

## What is implemented and verified

- Config validation that reports missing/invalid keys by name and never echoes a value.
- Auth and matchmaking adapters over an **injectable transport**, asserted against the documented
  URL, method, headers, and body — including a 19-digit `PlayerID` that survives JSON without
  IEEE-754 rounding.
- A bounded fetch transport: 5 s timeout, 64 KB streaming ceiling, `redirect: 'error'` so a
  redirect cannot carry the server API key to another host.
- One signing primitive (`signed-envelope.ts`) with the audience mixed into the MAC, so a session
  cookie and a room capability are not interchangeable. Constant-time comparison, size ceiling
  before any hashing, JSON parsed only after the MAC verifies.
- Room capabilities binding identity + room + issue/expiry + single-use nonce, ≤ 512 bytes, TTL
  ceiling enforced on verification as well as on issuance.
- Colyseus join enforcement: signature, expiry with bounded skew, room binding, replay, one seat per
  identity, and no cross-mode mixing in either direction.
- One seat per identity claimed in `onAuth` rather than in `onJoin`, so two connections presenting
  separately minted capabilities for the same identity cannot both pass the check before either is
  seated. The claim expires on its own, because Colyseus does not call `onLeave` for a connection
  that dies between the two callbacks.
- Allocation writes validated against the room token's identifier rules: an unsignable room id is a
  named refusal at the write and a `409 match_allocation_invalid` on read, never a signer exception.
- Allocation expiry decided by an injected clock — the same one the routes read — and never inferred
  from the expiry being written. A long-lived assignment no longer evicts everyone else's live one,
  and an allocation that has already expired when it arrives is refused (`expired-allocation`)
  instead of occupying a slot it can never satisfy. The store still fails closed at its cap rather
  than evicting a live entry.
- `cancel` and `enqueue` invalidate the caller's assignment **before** HIVE is called, so neither a
  HIVE failure nor a `matched` answer from the abandoned attempt can produce `roomAssigned: true` or
  a signed capability for a room the player has left. `status` is a read and ends nothing.
- Request bodies bounded by incremental reading: `Content-Length` refused first when it admits to
  being oversized, then the stream is pulled a chunk at a time, counted in bytes, and cancelled the
  moment it passes 2 KB. A chunked body with an absent or false `Content-Length` cannot make this
  process buffer more than the limit, and nothing is decoded or parsed until the count is bounded.
- One reader for the shared signing secret, used by both hosts, that refuses padding rather than
  normalizing it.

## Rollout order

1. Provision HIVE credentials and set the Next.js host keys. `GET /api/hive/session` should report
   `configured: true` with an empty `blockers` array.
2. Implement the match result callback route against the real payload and have it write into
   `MatchAllocationStore`. Until then step 3 cannot succeed.
3. Ship the browser queue client (Task 11) and set `NEXT_PUBLIC_HIVE_LOGIN=enabled`.
4. Set `ROOM_TOKEN_SECRET` on **both** hosts to the same value, with no surrounding whitespace;
   confirm `/health` reports `authenticatedJoin: true`. If either host refuses the value, fix the
   value rather than the check — they refuse for the same reason.
5. Flip `HELLBREAK_GUEST_JOIN=deny` on the production room server once the authenticated path
   carries real traffic. Keep the Pages demo pointed at a separate guest-allowing service.

## Operational notes

- The replay ledger and the allocation store are **in-process**. The room server runs one instance;
  a horizontally scaled deployment needs a shared implementation behind both interfaces before
  scaling out, or a replayed capability could be spent once per instance.
- A rejected join never spends its nonce, and never claims an identity either, so a player who is
  refused for another reason can still use the capability they were issued.
- An identity claimed by a connection that never reaches `onJoin` frees itself after
  `DEFAULT_PENDING_SEAT_MS` (5 s). A player whose client dies mid-join waits that long at worst, and
  needs a freshly minted capability anyway, since the one it presented is spent.
- Rotating `ROOM_TOKEN_SECRET` invalidates every live session cookie and capability at once. Rotate
  during a quiet window, or add a second accepted key first. Paste it with no surrounding
  whitespace: both hosts refuse a padded value outright rather than trimming it into a key the other
  host does not have.
- The allocation store's clock is the one the routes read. A shared implementation replacing this
  interface must take the same care: expiry belongs to the entry, and "now" belongs to the clock.
