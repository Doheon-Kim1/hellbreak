import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { Client } from '@colyseus/sdk'
import { Decoder } from '@colyseus/schema'
import { Protocol } from '@colyseus/shared-types'
import { HellbreakRoomState } from '../src/server/hellbreak-state'
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
  notice: string
  grabAck: number
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
      notice: '',
      grabAck: 0,
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
      const notice = document.querySelector('[data-testid="rescue-notice"]')?.textContent ?? ''
      if (/구조 시작|구조 성공|구조 실패|그립 소진/.test(notice)) probe.notice = notice
      probe.grabAck = Math.max(probe.grabAck, Number(document.querySelector('[data-testid="network-player"][data-own="true"]')?.getAttribute('data-grab-ack') ?? '0'))
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
      characterData: true,
      attributes: true,
    })
  }, link)
}

test.describe.configure({ timeout: 90_000 })

async function openOnlineTab(page: Page) {
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '온라인', exact: true }).click()
  // GPU/world initialization must finish before the server-owned match clock starts.
  await expect(page.locator('canvas')).toHaveAttribute('data-scene-ready', 'true', { timeout: 20000 })
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
    await pageA.bringToFront()
    await pageA.getByRole('button', { name: '온라인 룸 만들기' }).click()
    await expect(pageA.getByTestId('player-count')).toContainText('참가자 1/6')
    const roomId = await pageA.getByTestId('room-id').innerText()
    expect(roomId).not.toBe('')

    await pageB.bringToFront()
    await pageB.getByLabel('룸 ID').fill(roomId)
    await pageB.getByRole('button', { name: '참가', exact: true }).click()

    await expect(pageA.getByTestId('player-count')).toContainText('참가자 2/6')
    await expect(pageB.getByTestId('player-count')).toContainText('참가자 2/6')
    await expect(pageA.getByTestId('network-player')).toHaveCount(2)
    await expect(pageB.getByTestId('network-player')).toHaveCount(2)

    await pageA.bringToFront()
    const ownA = pageA.locator('[data-testid="network-player"][data-own="true"]')
    await expect(ownA).toHaveAttribute('data-character-model', 'infernal-climber', { timeout: SCENE_TIMEOUT_MS })
    const readStart = (page: Page, owner: boolean) => page.evaluate((isOwner) => {
      const node = document.querySelector(`[data-testid="network-player"][data-own="${isOwner}"]`)!
      const canvas = document.querySelector<HTMLCanvasElement>('canvas')!
      return { id: node.getAttribute('data-player-id'), model: node.getAttribute('data-character-model'),
        pose: node.getAttribute('data-character-pose'), alive: node.getAttribute('data-alive'),
        text: node.textContent, x: Number(node.getAttribute('data-x')), z: Number(node.getAttribute('data-z')),
        yaw: Number(canvas.dataset.cameraYaw), ready: canvas.dataset.sceneReady,
        covered: Boolean(document.querySelector('.key-art')) }
    }, owner)
    // Read whole start evidence coherently, not via locator evaluation's extra auto-wait trips.
    const [initial, peerInitial] = await Promise.all([readStart(pageA, true), readStart(pageB, false)])
    const ownPlayerId = initial.id
    expect(ownPlayerId).toBeTruthy()
    expect(peerInitial.id).toBe(ownPlayerId)
    expect(initial.model).toBe('infernal-climber')
    expect(initial.pose).toBe('idle')
    expect(initial.alive).toBe('true')
    expect(initial.ready).toBe('true')
    expect(initial.covered).toBe(false)
    expect(Number.isFinite(initial.x) && Number.isFinite(initial.z) && Number.isFinite(initial.yaw)).toBe(true)
    const before = initial.text
    const mirroredA = pageB.locator(`[data-testid="network-player"][data-player-id="${ownPlayerId}"]`)
    const mirroredBefore = peerInitial.text
    const startX = initial.x
    const startZ = initial.z
    // Native keyboard intent precedes extra cosmetic reads; the server's lava clock stays real.
    const yaw = initial.yaw
    await pageA.keyboard.down('KeyW')
    try {
      await expect.poll(() => ownA.evaluate((node, start) => {
        const x = Number(node.getAttribute('data-x')), z = Number(node.getAttribute('data-z'))
        return (x - start.x) * -Math.sin(start.yaw) + (z - start.z) * -Math.cos(start.yaw)
      }, { x: startX, z: startZ, yaw }), { timeout: INPUT_OBSERVATION_MS }).toBeGreaterThan(0.25)
    } finally {
      await pageA.keyboard.up('KeyW')
    }
    await expect.poll(async () => (await ownA.innerText()) !== before).toBe(true)
    await pageB.bringToFront()
    await expect.poll(() => mirroredA.evaluate((node, start) => {
      const x = Number(node.getAttribute('data-x')), z = Number(node.getAttribute('data-z'))
      return (x - start.x) * -Math.sin(start.yaw) + (z - start.z) * -Math.cos(start.yaw)
    }, { x: startX, z: startZ, yaw }), { timeout: INPUT_OBSERVATION_MS }).toBeGreaterThan(0.25)
    await expect(mirroredA).toHaveAttribute('data-character-model', 'infernal-climber')
    await expect.poll(async () => (await mirroredA.innerText()) !== mirroredBefore).toBe(true)

    // Capture cosmetics only after genuine input and mirrored displacement beat the live lava clock.
    await pageA.screenshot({ path: 'test-results/multiplayer-connected.png', fullPage: true })

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
  const contextA = await browser.newContext({ viewport: { width: 960, height: 640 } })
  const contextB = await browser.newContext({ viewport: { width: 960, height: 640 } })
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()
  const pageErrors: string[] = []
  pageA.on('pageerror', (error) => pageErrors.push(`A: ${error.message}`))
  pageB.on('pageerror', (error) => pageErrors.push(`B: ${error.message}`))
  // Decode the exact incoming browser frames read-only. Software WebGL can batch React renders
  // over a whole jump; an ACK alone is not proof of upward physics, so retain wire-level ascent.
  const wirePeaks = [new Map<string, number>(), new Map<string, number>()]
  for (const [index, page] of [pageA, pageB].entries()) page.on('websocket', (socket) => {
    const decoder = new Decoder(new HellbreakRoomState())
    socket.on('framereceived', ({ payload }) => {
      if (!Buffer.isBuffer(payload) || (payload[0] !== Protocol.ROOM_STATE && payload[0] !== Protocol.ROOM_STATE_PATCH)) return
      try {
        decoder.decode(payload, { offset: 1 })
        decoder.state.players.forEach((runner) => {
          if (runner.alive && !runner.grounded && runner.lastAcknowledgedJump > 0) {
            wirePeaks[index].set(runner.id, Math.max(wirePeaks[index].get(runner.id) ?? -Infinity, runner.y))
          }
        })
      } catch (error) { pageErrors.push(`wire decode: ${String(error)}`) }
    })
  })
  try {
    await openOnlineTab(pageA)
    await openOnlineTab(pageB)
    await pageA.bringToFront()
    await pageA.getByRole('button', { name: '온라인 룸 만들기' }).click()
    await expect(pageA.getByTestId('player-count')).toContainText('참가자 1/6')
    const roomId = await pageA.getByTestId('room-id').innerText()
    await pageB.bringToFront()
    await pageB.getByLabel('룸 ID').fill(roomId)
    await pageB.getByRole('button', { name: '참가', exact: true }).click()
    await expect(pageA.getByTestId('network-player')).toHaveCount(2)
    await expect(pageB.getByTestId('room-id')).toHaveText(roomId)
    await pageA.bringToFront()
    // One coherent browser trip captures each real row/HUD and installs its landing observer.
    // Software WebGL makes many serialized locator reads consume the entire live lava window.
    const observe = (page: Page, owner: boolean) => page.evaluate((isOwner) => {
      const row = document.querySelector(`[data-testid="network-player"][data-own="${isOwner}"]`)!
      const own = document.querySelector('[data-testid="network-player"][data-own="true"]')!
      const pose = (node: Element) => ({ id: node.getAttribute('data-player-id')!,
        y: Number(node.getAttribute('data-y')), grounded: node.getAttribute('data-grounded') === 'true',
        alive: node.getAttribute('data-alive') === 'true', ack: Number(node.getAttribute('data-jump-ack')) })
      const hud = () => ({
        alive: document.querySelector('[data-testid="online-alive"]')?.textContent,
        eliminations: document.querySelector('[data-testid="online-eliminations"]')?.textContent,
        time: document.querySelector('[data-testid="online-timer"]')?.textContent ?? '',
        lava: document.querySelector('[data-testid="online-lava"]')?.textContent ?? '',
      })
      const start = pose(row), idle = pose(own), initialHud = hud()
      const read = () => {
        const current = pose(row), currentHud = hud()
        if (current.ack > 0) row.setAttribute('data-observed-jump-ack', String(current.ack))
        // Latch only simultaneous genuine supported landing/HUD; wire ascent is asserted separately.
        if (current.ack > 0 && current.alive && current.grounded
          && Math.abs(current.y - start.y) < 0.1 && currentHud.alive === '2'
          && currentHud.eliminations === '0' && currentHud.time !== initialHud.time
          && row.getAttribute('data-observed-landing') !== 'true') {
          row.setAttribute('data-observed-landing-hud', JSON.stringify({ ...currentHud, own: pose(own) }))
          row.setAttribute('data-observed-landing', 'true')
        }
      }
      new MutationObserver(read).observe(document.body, { attributes: true, childList: true,
        characterData: true, subtree: true,
        attributeFilter: ['data-y', 'data-grounded', 'data-jump-ack', 'data-alive'] })
      return { start, idle, hud: initialHud }
    }, owner)
    const [evidenceA, evidenceB] = await Promise.all([observe(pageA, true), observe(pageB, false)])
    const startA = evidenceA.start, startB = evidenceB.idle
    const hudA = evidenceA.hud, hudB = evidenceB.hud
    expect(evidenceB.start.id).toBe(startA.id)
    expect(startA.id).toBeTruthy()
    expect(startB.id).toBeTruthy()
    expect(Number.isFinite(startA.y) && Number.isFinite(startB.y)).toBe(true)
    expect(startA.id).not.toBe(startB.id)
    expect(startA).toMatchObject({ grounded: true, alive: true, ack: 0 })
    expect(startB).toMatchObject({ grounded: true, alive: true, ack: 0 })
    expect(hudA).toMatchObject({ alive: '2', eliminations: '0' })
    expect(hudB).toMatchObject({ alive: '2', eliminations: '0' })
    const clockBeforeJump = clockSeconds(hudA.time)
    expect(clockBeforeJump).toBeGreaterThan(0)
    expect(clockBeforeJump).toBeLessThanOrEqual(180)
    expect(Math.abs(clockBeforeJump - clockSeconds(hudB.time))).toBeLessThanOrEqual(2)
    const ownA = pageA.locator('[data-testid="network-player"][data-own="true"]')
    const mirrored = pageB.locator(`[data-testid="network-player"][data-player-id="${startA.id}"]`)
    // Playing mode's top-left canvas is beneath the HUD; use an unobstructed native click.
    await pageA.locator('canvas').click({ position: { x: 840, y: 420 } })
    let acknowledged = 0
    for (let press = 0; press < JUMP_PRESS_ATTEMPTS && acknowledged === 0; press += 1) {
      await pageA.keyboard.press('Space')
      await expect.poll(async () => Number(await ownA.getAttribute('data-observed-jump-ack')),
        { timeout: INPUT_OBSERVATION_MS, intervals: [100] }).toBeGreaterThan(0).catch(() => undefined)
      acknowledged = Number(await ownA.getAttribute('data-observed-jump-ack'))
    }
    expect(acknowledged).toBeGreaterThan(0)
    for (const peaks of wirePeaks) await expect.poll(() => peaks.get(startA.id) ?? -Infinity).toBeGreaterThan(startA.y + 0.2)
    await expect(ownA).toHaveAttribute('data-observed-landing', 'true', { timeout: INPUT_OBSERVATION_MS })
    await expect(mirrored).toHaveAttribute('data-observed-jump-ack', String(acknowledged), { timeout: INPUT_OBSERVATION_MS })
    await expect(mirrored).toHaveAttribute('data-observed-landing', 'true', { timeout: INPUT_OBSERVATION_MS })
    const [finalA, finalB] = await Promise.all([ownA, mirrored].map(async (row) =>
      JSON.parse((await row.getAttribute('data-observed-landing-hud'))!) as {
        alive: string; eliminations: string; time: string; lava: string;
        own: { ack: number; y: number; grounded: boolean; alive: boolean }
      }))
    const idle = finalB.own
    expect(idle.ack).toBe(0)
    expect(idle.grounded).toBe(true)
    expect(idle.alive).toBe(true)
    expect(Math.abs(idle.y - startB.y)).toBeLessThan(0.05)

    expect(finalA).toMatchObject({ alive: '2', eliminations: '0' })
    expect(finalB).toMatchObject({ alive: '2', eliminations: '0' })
    expect(finalA.lava).toMatch(LAVA_LABEL)
    expect(finalB.lava).toMatch(LAVA_LABEL)
    expect(clockSeconds(finalA.time)).toBeGreaterThan(0)
    expect(clockSeconds(finalA.time)).toBeLessThan(clockBeforeJump)
    expect(Math.abs(clockSeconds(finalA.time) - clockSeconds(finalB.time))).toBeLessThanOrEqual(2)
    await pageA.screenshot({ path: 'test-results/multiplayer-jump.png', fullPage: true })
    expect(pageErrors).toEqual([])
  } finally { await contextA.close(); await contextB.close() }
})

test('browser rescue input creates one server-owned lifeline to a real room client', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await openOnlineTab(page)
  const room = await new Client('http://127.0.0.1:2567')
    .create<HellbreakRoomState>(HELLBREAK_ROOM_NAME)

  try {
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
    // Walk into the actual first-climb (+X/-Z) view cone using only ordinary server input.
    const sdkStart = room.state.players.get(jumperId)!
    const targetX = Number(await rescuer.getAttribute('data-x')) + 0.7
    const targetZ = Number(await rescuer.getAttribute('data-z')) - 0.7
    const walkYaw = Math.atan2(-(targetX - sdkStart.x), -(targetZ - sdkStart.z))
    room.send('input', {
      sequence: 1,
      forward: true,
      backward: false,
      left: false,
      right: false,
      sprint: false,
      jump: false,
      grab: false,
      cameraYaw: walkYaw,
    })
    await expect.poll(() => room.state.players.get(jumperId)?.x ?? -26, {
      timeout: INPUT_OBSERVATION_MS,
      intervals: [25],
    }).toBeGreaterThan(targetX)
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

    const canvasBox = await canvas.boundingBox()
    expect(canvasBox).not.toBeNull()
    const yawBeforeHover = await canvas.getAttribute('data-camera-yaw')
    await page.mouse.move(canvasBox!.x + canvasBox!.width * 0.75, canvasBox!.y + canvasBox!.height * 0.65)
    // Free-cursor motion genuinely rotates now. Separate that motion from lock acquisition itself.
    await expect(canvas).not.toHaveAttribute('data-camera-yaw', yawBeforeHover!)
    const yawBeforeAcquisition = await canvas.getAttribute('data-camera-yaw')
    expect(yawBeforeAcquisition).not.toBeNull()
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
      // A notice genuinely rendered during rescue is latched before game-over unmounts that HUD.
      expect(readout.notice).toMatch(/구조 시작|구조 성공|구조 실패|그립 소진/)
      await page.mouse.up({ button: 'left' })
      const acknowledgedGrab = readout.grabAck
      expect(acknowledgedGrab).toBeGreaterThan(initialGrabAck)
      await expect.poll(() => room.state.players.get(rescuerId)?.lastAcknowledgedGrab ?? 0, {
        timeout: INPUT_OBSERVATION_MS,
      }).toBeGreaterThanOrEqual(acknowledgedGrab)
      // The target now starts forward-right in the corrected view cone: room-owned pull moves -X.
      expect(room.state.players.get(jumperId)?.x ?? rescueStartX).toBeLessThan(rescueStartX - 0.02)
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
