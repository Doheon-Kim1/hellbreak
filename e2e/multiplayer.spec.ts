import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { Client } from '@colyseus/sdk'
import type { HellbreakRoomState } from '../src/server/hellbreak-state'
import { HELLBREAK_ROOM_NAME } from '../src/shared/multiplayer-protocol'

const SCENE_TIMEOUT_MS = 20_000
const INPUT_OBSERVATION_MS = 8_000
/**
 * How many times a browser jump may be re-pressed. A press is one edge, dropped without a trace if
 * it lands while the 3D scene is starving the main thread, so the receipt — never a longer wait —
 * decides whether the runner has actually been asked to jump yet.
 */
const JUMP_PRESS_ATTEMPTS = 3
const LAVA_LABEL = /^용암 · (상승 중|폭발 임박|폭발 상승)$/
/** Lava proximity, said on the chip in words rather than left to the rope's colour. */
const RESCUE_URGENCY_BANDS = ['calm', 'urgent', 'critical']
/** The grip meter's own bands, so the readout is never a bare number. */
const RESCUE_GRIP_BANDS = ['steady', 'warning', 'danger']

/** One synchronous look at the page's whole rescue readout. */
interface RescueReadoutProbe {
  /** Latched after one coherent semantic frame and both renderer-applied reciprocal rig poses. */
  observed: boolean
  semanticFrameObserved: boolean
  rescuerRigObserved: boolean
  targetRigObserved: boolean
  /** The most recent frame, quoted verbatim when the latch never closed. */
  last: string
}

function rescueReadoutProbe(page: Page): Promise<RescueReadoutProbe> {
  return page.evaluate(() => (
    (window as unknown as { __rescueReadout: RescueReadoutProbe }).__rescueReadout
  ))
}

/**
 * Watches both evidence layers of one rescue. Reciprocal schema IDs and HUD semantics must coexist
 * in one synchronous React frame. Character pose and visual-link attributes are emitted only after
 * PlayerCharacter applies transforms in useFrame, so each rig latches separately with the reciprocal
 * counterpart ID it actually rendered; forcing those callbacks into the schema's DOM commit creates
 * an impossible timing contract rather than stronger evidence.
 *
 * It has to run inside the page. A live link lasts well under a second while the scene keeps the
 * main thread busy, so attributes fetched in separate round trips come from different instants and
 * can report a pairing the page never rendered. The grip meter is also mounted only while it has
 * something to say, and `locator.getAttribute` waits for an absent element instead of reporting it,
 * so an over-the-wire probe can spend its entire budget inside one read taken before the link even
 * existed. A MutationObserver cannot miss a frame the page committed: every attribute here is
 * written by React, so the coherent state always arrives with a mutation.
 */
async function watchRescueReadout(
  page: Page,
  link: { rescuerId: string; targetId: string; urgencies: string[]; gripBands: string[] },
) {
  await page.evaluate(({ rescuerId, targetId, urgencies, gripBands }) => {
    const probe = {
      observed: false,
      semanticFrameObserved: false,
      rescuerRigObserved: false,
      targetRigObserved: false,
      last: 'nothing sampled',
    }
    ;(window as unknown as { __rescueReadout: typeof probe }).__rescueReadout = probe
    const read = () => {
      const chips = Array.from(document.querySelectorAll('[data-testid="rescue-status"]'))
      const frame = {
        grabTarget: document.querySelector('[data-testid="network-player"][data-own="true"]')
          ?.getAttribute('data-grab-target') ?? '',
        rescuerPose: document.querySelector('[data-testid="network-player"][data-own="true"]')
          ?.getAttribute('data-character-pose') ?? '',
        rescuerVisualLink: document.querySelector('[data-testid="network-player"][data-own="true"]')
          ?.getAttribute('data-character-rescue-link') ?? '',
        grabbedBy: document.querySelector(`[data-testid="network-player"][data-player-id="${targetId}"]`)
          ?.getAttribute('data-grabbed-by') ?? '',
        targetPose: document.querySelector(`[data-testid="network-player"][data-player-id="${targetId}"]`)
          ?.getAttribute('data-character-pose') ?? '',
        targetVisualLink: document.querySelector(`[data-testid="network-player"][data-player-id="${targetId}"]`)
          ?.getAttribute('data-character-rescue-link') ?? '',
        holdingWithUrgency: chips.filter((chip) => (
          chip.getAttribute('data-state') === 'holding'
          && urgencies.includes(chip.getAttribute('data-urgency') ?? '')
        )).length,
        gripBand: document.querySelector('[data-testid="rescue-grip"]')
          ?.getAttribute('data-grip-band') ?? 'unmounted',
      }
      probe.last = JSON.stringify(frame)
      const schemaMatches = frame.grabTarget === targetId && frame.grabbedBy === rescuerId
      const rescuerPoseMatches = frame.rescuerVisualLink === targetId
        && frame.rescuerPose === 'rescuing'
      const targetPoseMatches = frame.targetVisualLink === rescuerId
        && frame.targetPose === 'rescued'
      const semanticFrameMatches = schemaMatches
        && frame.holdingWithUrgency === 1
        && gripBands.includes(frame.gripBand)
      probe.semanticFrameObserved ||= semanticFrameMatches
      probe.rescuerRigObserved ||= rescuerPoseMatches
      probe.targetRigObserved ||= targetPoseMatches
      probe.observed = probe.semanticFrameObserved
        && probe.rescuerRigObserved
        && probe.targetRigObserved
    }
    read()
    new MutationObserver(read).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
    })
  }, link)
}

test.describe.configure({ timeout: 90_000 })

async function openOnlineTab(page: Page) {
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '온라인', exact: true }).click()
}

/** The room only forwards input once the 3D scene renders, because that gates the send loop. */
async function waitForOnlineScene(page: Page) {
  await expect(page.locator('.key-art')).toHaveCount(0, { timeout: SCENE_TIMEOUT_MS })
  await expect(page.getByTestId('online-lava')).toBeVisible()
}

function clockSeconds(label: string): number {
  const [minutes, seconds] = label.trim().split(':').map(Number)
  return minutes * 60 + seconds
}

/**
 * Whether a published runner is standing at the height it took off from. Footing and height are one
 * fact about one tick, so both are read from the same row in a single call rather than fetched one
 * after the other, which can pair a height from mid-flight with a footing from after the landing.
 */
async function landedAt(runner: Locator, takeoffY: number, tolerance: number): Promise<boolean> {
  const pose = await runner.evaluate((row) => ({
    y: Number(row.getAttribute('data-y')),
    grounded: row.getAttribute('data-grounded') === 'true',
  }))
  return pose.grounded && Math.abs(pose.y - takeoffY) < tolerance
}

test('the online lobby offers the guest demo and closes the HIVE queue with a reason', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await openOnlineTab(page)

  const guest = page.getByTestId('multiplayer-mode-guest')
  const hive = page.getByTestId('multiplayer-mode-hive')

  await expect(guest).toBeEnabled()
  await expect(guest).toHaveAttribute('data-available', 'true')
  await expect(guest).toHaveAttribute('aria-pressed', 'true')

  // The dev server is a real Next.js origin, so the honest blocker is the missing browser login
  // rather than the static export. Either way the branch must never be offered as available.
  await expect(hive).toBeDisabled()
  await expect(hive).toHaveAttribute('data-available', 'false')
  await expect(page.getByTestId('hive-unavailable')).toBeVisible()
  await expect(page.getByTestId('hive-unavailable')).toHaveAttribute('data-blocker', 'login-unwired')
  await expect(page.getByTestId('hive-queue-pending')).toHaveCount(0)

  // Closing the authenticated branch must not close the demo it falls back to.
  await page.getByRole('button', { name: '온라인 룸 만들기' }).click()
  await expect(page.getByTestId('player-count')).toContainText('참가자 1/6')
  await expect(page.getByTestId('room-mode')).toHaveAttribute('data-mode', 'guest')
  expect(pageErrors).toEqual([])
})

/**
 * Every POST the Colyseus SDK sends to matchmaking. Preflights are excluded by method so the count
 * is "how many rooms were asked for", which is the number that actually matters.
 */
function watchMatchmaking(page: Page): string[] {
  const requests: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/matchmake/')) {
      requests.push(request.url())
    }
  })
  return requests
}

/**
 * The public regression: on GitHub Pages the free room server is suspended, so the SDK's own
 * matchmaking request was the thing that discovered it and the player was shown `Failed to fetch`.
 * Health failing first and then answering is exactly that cold start, at test speed.
 */
test('a suspended room server is woken first, then asked for exactly one room', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const matchmaking = watchMatchmaking(page)
  let probes = 0
  await page.route('**/health', async (route) => {
    probes += 1
    // The first two attempts fail the way a browser fails against an instance that is not up.
    if (probes <= 2) await route.abort('failed')
    else await route.continue()
  })

  await openOnlineTab(page)
  await page.getByRole('button', { name: '온라인 룸 만들기' }).click()

  // Busy and truthful while it waits: the wait is named, and nothing claims to be connected.
  const progress = page.getByTestId('room-progress')
  await expect(progress).toHaveAttribute('data-phase', 'waking')
  await expect(progress).toContainText('무료 룸 서버를 깨우는 중')
  await expect(page.getByTestId('room-id')).toHaveCount(0)
  await expect(page.locator('.room-error')).toHaveCount(0)

  await expect(page.getByTestId('player-count')).toContainText('참가자 1/6', { timeout: 30_000 })
  await expect(page.getByTestId('room-mode')).toHaveAttribute('data-mode', 'guest')
  await expect(progress).toHaveCount(0)
  expect(probes).toBe(3)
  // Never retried: a second create through an ambiguous answer is a room nobody is in.
  expect(matchmaking).toHaveLength(1)
  expect(pageErrors).toEqual([])
})

test('a room server that never wakes ends in a stable Korean message and creates nothing', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const matchmaking = watchMatchmaking(page)
  await page.route('**/health', (route) => route.abort('failed'))

  await openOnlineTab(page)
  await page.getByRole('button', { name: '온라인 룸 만들기' }).click()
  await expect(page.getByTestId('room-progress')).toHaveAttribute('data-phase', 'waking')

  const failure = page.locator('.room-error')
  await expect(failure).toContainText('무료 룸 서버', { timeout: 60_000 })
  await expect(failure).toContainText('다시 시도')
  // The raw browser sentence is what this whole boundary exists to keep off the screen.
  await expect(failure).not.toContainText('Failed to fetch')
  await expect(page.getByTestId('room-id')).toHaveCount(0)
  await expect(page.getByTestId('room-progress')).toHaveCount(0)
  // Nothing was ever asked of the room server, so there is no half-made room to clean up.
  expect(matchmaking).toEqual([])
  // And the player can act on the advice they were just given.
  await expect(page.getByRole('button', { name: '온라인 룸 만들기' })).toBeEnabled()
  expect(pageErrors).toEqual([])
})

test('a server that refuses guests says so instead of trying to create a room', async ({ page }) => {
  const matchmaking = watchMatchmaking(page)
  await page.route('**/health', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({ ok: true, room: 'hellbreak', guestJoin: false, authenticatedJoin: true }),
  }))

  await openOnlineTab(page)
  await page.getByRole('button', { name: '온라인 룸 만들기' }).click()

  const failure = page.locator('.room-error')
  await expect(failure).toContainText('게스트')
  await expect(failure).not.toContainText('Failed to fetch')
  expect(matchmaking).toEqual([])
})

/**
 * The other half of the leak: even past a healthy server, the SDK's own failure text was put on
 * screen verbatim. `Failed to fetch` names one socket and tells a player nothing they can do.
 */
test('a refused room request is written in Korean rather than in the browser words', async ({ page }) => {
  await page.route('**/matchmake/**', (route) => route.abort('failed'))

  await openOnlineTab(page)
  await page.getByRole('button', { name: '온라인 룸 만들기' }).click()

  const failure = page.locator('.room-error')
  await expect(failure).toContainText('룸을 만들지 못했습니다')
  await expect(failure).not.toContainText('Failed to fetch')
  await expect(failure).not.toContainText('matchmake')
  await expect(page.getByTestId('room-id')).toHaveCount(0)
})

test('the HIVE routes answer honestly on a server origin with no credentials', async ({ request }) => {
  const capability = await request.get('/api/hive/session')
  expect(capability.status()).toBe(200)
  const report = await capability.json()
  expect(report.configured).toBe(false)
  expect(report.blockers).toContain('ROOM_TOKEN_SECRET')

  // Every state-changing route refuses rather than pretending, and names no value.
  for (const path of ['/api/hive/session', '/api/hive/matchmaking', '/api/hive/room-token']) {
    const response = await request.post(path, { data: {} })
    expect(response.status()).toBe(503)
    expect(await response.json()).toMatchObject({ error: 'hive_not_configured' })
  }
})

test('two browsers create, join, synchronize movement, and leave a room', async ({ browser }) => {
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()
  const pageErrors: string[] = []
  pageA.on('pageerror', (error) => pageErrors.push(`A: ${error.message}`))
  pageB.on('pageerror', (error) => pageErrors.push(`B: ${error.message}`))

  try {
    // Compile and reveal both online clients before the authoritative match clock starts.
    await openOnlineTab(pageA)
    await openOnlineTab(pageB)
    await pageA.getByRole('button', { name: '온라인 룸 만들기' }).click()
    await expect(pageA.getByTestId('player-count')).toContainText('참가자 1/6')
    const roomId = await pageA.getByTestId('room-id').innerText()
    expect(roomId).not.toBe('')

    await pageB.getByLabel('룸 ID').fill(roomId)
    await pageB.getByRole('button', { name: '참가', exact: true }).click()

    await expect(pageA.getByTestId('player-count')).toContainText('참가자 2/6')
    await expect(pageB.getByTestId('player-count')).toContainText('참가자 2/6')
    await expect(pageA.getByTestId('network-player')).toHaveCount(2)
    await expect(pageB.getByTestId('network-player')).toHaveCount(2)
    await pageA.screenshot({ path: 'test-results/multiplayer-connected.png', fullPage: true })

    const ownA = pageA.locator('[data-testid="network-player"][data-own="true"]')
    const ownPlayerId = await ownA.getAttribute('data-player-id')
    expect(ownPlayerId).toBeTruthy()
    await expect(ownA).toHaveAttribute('data-character-model', 'infernal-climber')
    await expect(ownA).toHaveAttribute('data-character-pose', 'idle')
    const before = await ownA.innerText()
    const mirroredA = pageB.locator(`[data-testid="network-player"][data-player-id="${ownPlayerId}"]`)
    await expect(mirroredA).toHaveAttribute('data-character-model', 'infernal-climber')
    const mirroredBefore = await mirroredA.innerText()

    await waitForOnlineScene(pageA)
    await pageA.bringToFront()
    const canvasA = pageA.locator('canvas')
    const startX = Number(await ownA.getAttribute('data-x'))
    const startZ = Number(await ownA.getAttribute('data-z'))
    await pageA.getByRole('button', { name: '마우스 조작 시작' }).click()
    await expect.poll(() => pageA.evaluate(() => document.pointerLockElement?.tagName ?? ''))
      .toBe('CANVAS')
    await pageA.waitForTimeout(320)
    const initialYaw = Number(await canvasA.getAttribute('data-camera-yaw'))
    await pageA.evaluate(() => {
      for (let index = 0; index < 20; index += 1) {
        const event = new MouseEvent('mousemove', { bubbles: true })
        Object.defineProperty(event, 'movementX', { value: 20 })
        Object.defineProperty(event, 'movementY', { value: 0 })
        document.dispatchEvent(event)
      }
    })
    await expect.poll(async () => Math.abs(
      Number(await canvasA.getAttribute('data-camera-yaw')) - initialYaw,
    )).toBeGreaterThan(0.1)
    await pageA.keyboard.down('KeyW')
    try {
      await expect.poll(async () => {
        const movedX = Number(await ownA.getAttribute('data-x')) - startX
        const movedZ = Number(await ownA.getAttribute('data-z')) - startZ
        const yaw = Number(await canvasA.getAttribute('data-camera-yaw'))
        return movedX * -Math.sin(yaw) + movedZ * -Math.cos(yaw)
      }, {
        timeout: INPUT_OBSERVATION_MS,
      }).toBeGreaterThan(0.25)
      await expect.poll(async () => (await ownA.innerText()) !== before, {
        timeout: INPUT_OBSERVATION_MS,
      }).toBe(true)
      await pageB.bringToFront()
      await expect.poll(async () => (await mirroredA.innerText()) !== mirroredBefore, {
        timeout: INPUT_OBSERVATION_MS,
      }).toBe(true)
    } finally {
      await pageA.bringToFront()
      await pageA.keyboard.up('KeyW')
    }

    await pageB.bringToFront()
    await pageB.getByRole('button', { name: '룸 나가기' }).click()
    await expect(pageA.getByTestId('player-count')).toContainText('참가자 1/6')
    await expect(pageA.getByTestId('network-player')).toHaveCount(1)
    expect(pageErrors).toEqual([])
  } finally {
    await contextA.close()
    await contextB.close()
  }
})

test('one shared room drives server jump physics and the match HUD in both browsers', async ({ browser }) => {
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()
  const pageErrors: string[] = []
  pageA.on('pageerror', (error) => pageErrors.push(`A: ${error.message}`))
  pageB.on('pageerror', (error) => pageErrors.push(`B: ${error.message}`))

  try {
    // Load both pages before room creation so compilation does not consume the match clock.
    await openOnlineTab(pageA)
    await openOnlineTab(pageB)

    await pageA.getByRole('button', { name: '온라인 룸 만들기' }).click()
    await expect(pageA.getByTestId('player-count')).toContainText('참가자 1/6')
    const roomId = await pageA.getByTestId('room-id').innerText()
    await pageB.getByLabel('룸 ID').fill(roomId)
    await pageB.getByRole('button', { name: '참가', exact: true }).click()

    await expect(pageA.getByTestId('network-player')).toHaveCount(2)
    await expect(pageB.getByTestId('network-player')).toHaveCount(2)
    await expect(pageB.getByTestId('room-id')).toHaveText(roomId)
    // Keep the input owner in the foreground. A background R3F tab can stop forwarding input while
    // the authoritative match and lava continue advancing.
    await pageA.bringToFront()
    await waitForOnlineScene(pageA)

    const ownA = pageA.locator('[data-testid="network-player"][data-own="true"]')
    const ownB = pageB.locator('[data-testid="network-player"][data-own="true"]')
    const jumperId = (await ownA.getAttribute('data-player-id')) ?? ''
    const idlerId = (await ownB.getAttribute('data-player-id')) ?? ''
    expect(jumperId).not.toBe('')
    expect(idlerId).not.toBe('')
    expect(jumperId).not.toBe(idlerId)

    await expect(ownA).toHaveAttribute('data-alive', 'true')
    await expect(ownA).toHaveAttribute('data-grounded', 'true')
    const takeoffY = Number(await ownA.getAttribute('data-y'))
    const idlerY = Number(await ownB.getAttribute('data-y'))
    const initialJumpAck = Number(await ownA.getAttribute('data-jump-ack'))
    expect(Number.isFinite(takeoffY)).toBe(true)
    expect(Number.isFinite(idlerY)).toBe(true)
    expect(initialJumpAck).toBe(0)
    const clockBeforeJump = clockSeconds(await pageA.getByTestId('online-timer').innerText())
    expect(clockBeforeJump).toBeGreaterThan(0)
    expect(clockBeforeJump).toBeLessThanOrEqual(180)

    // Start the time-sensitive authoritative input before checking the secondary browser's HUD.
    // The room clock and lava keep advancing while background-page assertions wait.
    await pageA.locator('canvas').click({ position: { x: 20, y: 20 } })
    // The local edge stays queued until sent; poll only the server-owned acknowledgement.
    //
    // A press is a single edge: the page arms it on keydown and forwards it on its next send tick,
    // so one that lands while the scene has the main thread never reaches the room at all. Press
    // again only while the receipt has not moved and this runner is alive and standing — exactly
    // the state the room owes a takeoff in — so a jump the room refuses still fails here, and a
    // press is never repeated into a pose where refusing it would be correct.
    const publishedJumpAck = async () => Number(await ownA.getAttribute('data-jump-ack'))
    let acknowledgedJump = initialJumpAck
    for (let press = 0; press < JUMP_PRESS_ATTEMPTS && acknowledgedJump === initialJumpAck; press += 1) {
      await expect(ownA).toHaveAttribute('data-alive', 'true')
      await expect(ownA).toHaveAttribute('data-grounded', 'true')
      await pageA.keyboard.press('Space')
      await expect.poll(publishedJumpAck, { timeout: INPUT_OBSERVATION_MS, intervals: [100] })
        .toBeGreaterThan(initialJumpAck)
        .catch(() => undefined)
      acknowledgedJump = await publishedJumpAck()
    }
    expect(acknowledgedJump).toBeGreaterThan(initialJumpAck)

    // One authoritative match feeds both HUDs immediately after the time-sensitive jump receipt.
    await pageB.bringToFront()
    await waitForOnlineScene(pageB)
    await expect(pageA.getByTestId('online-alive')).toHaveText('2')
    await expect(pageB.getByTestId('online-alive')).toHaveText('2')
    await expect(pageA.getByTestId('online-eliminations')).toHaveText('0')
    await expect(pageB.getByTestId('online-eliminations')).toHaveText('0')
    await expect(pageA.getByTestId('online-lava')).toHaveText(LAVA_LABEL)
    await expect(pageB.getByTestId('online-lava')).toHaveText(LAVA_LABEL)
    const remainingA = clockSeconds(await pageA.getByTestId('online-timer').innerText())
    const remainingB = clockSeconds(await pageB.getByTestId('online-timer').innerText())
    expect(remainingA).toBeGreaterThan(0)
    expect(remainingA).toBeLessThan(clockBeforeJump)
    expect(Math.abs(remainingA - remainingB)).toBeLessThanOrEqual(2)

    // The authoritative room, not the browser, applies gravity and the platform landing. Standing
    // and the height are one fact, so both are read from one row in one go: fetched separately they
    // can pair a mid-flight height with a footing from after the landing.
    await pageA.bringToFront()
    await expect.poll(() => landedAt(ownA, takeoffY, 0.1), {
      timeout: INPUT_OBSERVATION_MS,
      intervals: [100],
    }).toBe(true)
    await pageA.screenshot({ path: 'test-results/multiplayer-jump.png', fullPage: true })

    // Browser B receives the same takeoff receipt and synchronized landing. Both receipts are read
    // together and only have to agree in the end, because a re-pressed jump can leave this browser
    // one takeoff ahead of the other for as long as a patch takes to arrive.
    await pageB.bringToFront()
    const mirroredJumper = pageB.locator(`[data-testid="network-player"][data-player-id="${jumperId}"]`)
    await expect.poll(async () => {
      const [own, mirrored] = await Promise.all([
        publishedJumpAck(),
        mirroredJumper.getAttribute('data-jump-ack'),
      ])
      return { receipt: own > initialJumpAck, mirrored: mirrored === String(own) }
    }, { timeout: INPUT_OBSERVATION_MS, intervals: [100] }).toEqual({ receipt: true, mirrored: true })
    await expect.poll(() => landedAt(mirroredJumper, takeoffY, 0.1), {
      timeout: INPUT_OBSERVATION_MS,
      intervals: [100],
    }).toBe(true)

    // The other browser never requested a jump, so its acknowledgement and pose stay unchanged.
    await expect(ownB).toHaveAttribute('data-jump-ack', '0')
    await expect(ownB).toHaveAttribute('data-grounded', 'true')
    await expect.poll(async () => Math.abs(Number(await ownB.getAttribute('data-y')) - idlerY)).toBeLessThan(0.05)

    expect(pageErrors).toEqual([])
  } finally {
    await contextA.close()
    await contextB.close()
  }
})

test('browser rescue input creates one server-owned lifeline to a real room client', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const room = await new Client('http://127.0.0.1:2567')
    .create<HellbreakRoomState>(HELLBREAK_ROOM_NAME)

  try {
    await openOnlineTab(page)
    await page.getByLabel('룸 ID').fill(room.roomId)
    await page.getByRole('button', { name: '참가', exact: true }).click()
    await expect(page.getByTestId('player-count')).toContainText('참가자 2/6')
    await expect(page.getByTestId('network-player')).toHaveCount(2)
    await waitForOnlineScene(page)

    const rescuer = page.locator('[data-testid="network-player"][data-own="true"]')
    const jumperId = room.sessionId
    const rescuerId = (await rescuer.getAttribute('data-player-id')) ?? ''
    expect(rescuerId).not.toBe('')
    expect(jumperId).not.toBe(rescuerId)
    const jumper = page.locator(`[data-testid="network-player"][data-player-id="${jumperId}"]`)
    const initialGrabAck = Number(await rescuer.getAttribute('data-grab-ack'))
    expect(initialGrabAck).toBe(0)
    await expect(rescuer).toHaveAttribute('data-grounded', 'true')
    await expect(jumper).toHaveAttribute('data-grounded', 'true')

    // The browser sends only held rescue. The second client sends only a normal jump edge; neither can
    // name a rescue target or submit a pose, force, or grip value.
    // Walk the SDK player into the browser's default -X/-Z camera cone using ordinary server input.
    room.send('input', {
      sequence: 1,
      forward: true,
      backward: false,
      left: false,
      right: true,
      sprint: false,
      jump: false,
      grab: false,
      cameraYaw: 0,
    })
    await expect.poll(() => room.state.players.get(jumperId)?.x ?? -26, {
      timeout: INPUT_OBSERVATION_MS,
      intervals: [25],
    }).toBeGreaterThan(-25.6)
    room.send('input', {
      sequence: 2,
      forward: false,
      backward: false,
      left: false,
      right: false,
      sprint: false,
      jump: false,
      grab: false,
      cameraYaw: 0,
    })
    await expect.poll(() => room.state.players.get(jumperId)?.lastProcessedInput ?? 0, {
      timeout: INPUT_OBSERVATION_MS,
      intervals: [25],
    }).toBe(2)
    const rescueStartX = room.state.players.get(jumperId)?.x ?? -26
    // Armed before the first hold, so no link can form unwatched.
    await watchRescueReadout(page, {
      rescuerId,
      targetId: jumperId,
      urgencies: RESCUE_URGENCY_BANDS,
      gripBands: RESCUE_GRIP_BANDS,
    })
    const canvas = page.locator('canvas')
    await page.evaluate(() => {
      const element = document.querySelector('canvas') as HTMLCanvasElement & {
        __nativeRequestPointerLock?: HTMLCanvasElement['requestPointerLock']
      }
      element.__nativeRequestPointerLock = element.requestPointerLock
      element.requestPointerLock = () => Promise.reject(new DOMException('denied', 'NotAllowedError'))
    })
    await canvas.dispatchEvent('mousedown', { button: 0 })
    await expect(canvas).toHaveAttribute('data-pointer-lock-denied', 'true')
    await expect(canvas).toHaveAttribute('data-grab-held', 'true')
    await page.evaluate(() => window.dispatchEvent(new MouseEvent('mouseup', { button: 0 })))
    await expect(canvas).toHaveAttribute('data-grab-held', 'false')
    await expect(canvas).toHaveAttribute('data-transmitted-grab-count', /\d+/)
    await page.waitForTimeout(100)
    const transmittedGrabCountBeforeAcquisition = await canvas.getAttribute('data-transmitted-grab-count')
    await page.evaluate(() => {
      const element = document.querySelector('canvas') as HTMLCanvasElement & {
        __nativeRequestPointerLock?: HTMLCanvasElement['requestPointerLock']
      }
      if (element.__nativeRequestPointerLock) {
        element.requestPointerLock = element.__nativeRequestPointerLock
        delete element.__nativeRequestPointerLock
      }
      delete element.dataset.pointerLockDenied
    })
    await expect(canvas).not.toHaveAttribute('data-pointer-lock-denied')

    const yawBeforeAcquisition = await canvas.getAttribute('data-camera-yaw')
    expect(yawBeforeAcquisition).not.toBeNull()
    const canvasBox = await canvas.boundingBox()
    expect(canvasBox).not.toBeNull()
    await canvas.click({
      force: true,
      position: {
        x: (canvasBox?.width ?? 100) * 0.75,
        y: (canvasBox?.height ?? 100) * 0.65,
      },
    })
    await expect.poll(() => page.evaluate(() => document.pointerLockElement?.tagName ?? ''))
      .toBe('CANVAS')
    // The canvas acquisition click is lock-only and must not become a grab edge or camera warp.
    await page.waitForTimeout(320)
    await expect(rescuer).toHaveAttribute('data-grab-ack', '0')
    await expect(canvas).toHaveAttribute('data-grab-held', 'false')
    await expect(canvas).toHaveAttribute(
      'data-transmitted-grab-count',
      transmittedGrabCountBeforeAcquisition ?? '',
    )
    await expect(canvas).toHaveAttribute('data-camera-yaw', yawBeforeAcquisition ?? '')
    await page.mouse.down({ button: 'left' })
    await expect(canvas).toHaveAttribute('data-grab-held', 'true')
    try {
      await page.waitForTimeout(250)
      const schemaLink = { target: jumperId, incoming: rescuerId }
      let schemaObserved = false
      let readoutObserved = false
      let jumpSequence = 3
      const allObserved = () => schemaObserved && readoutObserved
      for (let attempt = 0; attempt < 4 && !allObserved(); attempt += 1) {
        room.send('input', {
          sequence: jumpSequence,
          forward: false,
          backward: false,
          left: false,
          right: false,
          sprint: false,
          jump: true,
          grab: false,
          cameraYaw: 0,
        })
        await expect.poll(() => room.state.players.get(jumperId)?.lastAcknowledgedJump ?? 0, {
          timeout: INPUT_OBSERVATION_MS,
          intervals: [50],
        }).toBe(jumpSequence)
        room.send('input', {
          sequence: jumpSequence + 1,
          forward: false,
          backward: false,
          left: false,
          right: false,
          sprint: false,
          jump: false,
          grab: false,
          cameraYaw: 0,
        })
        // The room's own copy of the link, read in this process, so watching it costs the busy
        // browser nothing.
        if (!schemaObserved) {
          schemaObserved = await expect.poll(() => ({
            target: room.state.players.get(rescuerId)?.grabTargetId ?? '',
            incoming: room.state.players.get(jumperId)?.grabbedById ?? '',
          }), { timeout: 1_200, intervals: [25] }).toEqual(schemaLink).then(() => true, () => false)
        }
        // The player-facing readout has to say the same thing the schema does: holding a teammate,
        // with lava proximity banded on the chip rather than left to the rope's colour, and a
        // banded grip meter on screen rather than a bare number. Which grip band it lands in
        // depends on how much grip earlier attempts burned, so any band counts. The page latches
        // that itself, so this only has to collect the latch — a link that came and went while the
        // schema was being read is still counted, and the order of the two reads stops mattering.
        if (!readoutObserved) {
          readoutObserved = (await rescueReadoutProbe(page)).observed
        }
        if (!allObserved()) {
          await expect.poll(() => room.state.players.get(jumperId)?.grounded ?? false, {
            timeout: INPUT_OBSERVATION_MS,
            intervals: [50],
          }).toBe(true)
          jumpSequence += 2
        }
      }
      // Read once more before judging: a link the schema already showed may have reached the page
      // only after the last collection.
      const readout = await rescueReadoutProbe(page)
      readoutObserved ||= readout.observed
      const cameraDiagnostic = await canvas.evaluate((element) => ({
        held: element.getAttribute('data-grab-held'),
        yaw: element.getAttribute('data-camera-yaw'),
        pitch: element.getAttribute('data-camera-pitch'),
      }))
      expect(
        schemaObserved,
        `the room never published the rescue link; camera ${JSON.stringify(cameraDiagnostic)}`,
      ).toBe(true)
      expect(readoutObserved, `no coherent rescue readout; last frame ${readout.last}`).toBe(true)
      // Milestones, and only milestones, reach the live region: never a per-frame grip value.
      await expect(page.getByTestId('rescue-notice'))
        .toHaveText(/구조 시작|구조 성공|구조 실패|그립 소진/)
      await page.mouse.up({ button: 'left' })
      const acknowledgedGrab = Number(await rescuer.getAttribute('data-grab-ack'))
      expect(acknowledgedGrab).toBeGreaterThan(initialGrabAck)
      await expect.poll(() => room.state.players.get(rescuerId)?.lastAcknowledgedGrab ?? 0, {
        timeout: INPUT_OBSERVATION_MS,
      }).toBeGreaterThanOrEqual(acknowledgedGrab)
      // The target started to the rescuer's left; the room-owned pull must move it toward +X.
      expect(room.state.players.get(jumperId)?.x ?? rescueStartX).toBeGreaterThan(rescueStartX + 0.02)
    } finally {
      await page.mouse.up({ button: 'left' })
    }

    await expect(rescuer).toHaveAttribute('data-grab-target', '', { timeout: INPUT_OBSERVATION_MS })
    await expect(jumper).toHaveAttribute('data-grabbed-by', '')
    await expect.poll(() => room.state.players.get(rescuerId)?.grabTargetId ?? 'missing', {
      timeout: INPUT_OBSERVATION_MS,
    }).toBe('')
    await expect(jumper).toHaveAttribute('data-grounded', 'true', { timeout: INPUT_OBSERVATION_MS })
    expect(pageErrors).toEqual([])
  } finally {
    await page.mouse.up({ button: 'left' }).catch(() => undefined)
    await room.leave(true).catch(() => undefined)
    await context.close()
  }
})
