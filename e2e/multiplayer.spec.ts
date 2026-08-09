import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { Client } from '@colyseus/sdk'
import type { HellbreakRoomState } from '../src/server/hellbreak-state'
import { HELLBREAK_ROOM_NAME } from '../src/shared/multiplayer-protocol'

const SCENE_TIMEOUT_MS = 20_000
const INPUT_OBSERVATION_MS = 8_000
const LAVA_LABEL = /^용암 · (상승 중|폭발 임박|폭발 상승)$/

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

test('two browsers create, join, synchronize movement, and leave a room', async ({ browser }) => {
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()
  const pageErrors: string[] = []
  pageA.on('pageerror', (error) => pageErrors.push(`A: ${error.message}`))
  pageB.on('pageerror', (error) => pageErrors.push(`B: ${error.message}`))

  try {
    await pageA.goto('/', { waitUntil: 'networkidle' })
    await pageA.getByRole('button', { name: '온라인', exact: true }).click()
    await pageA.getByRole('button', { name: '온라인 룸 만들기' }).click()
    await expect(pageA.getByTestId('player-count')).toContainText('참가자 1/6')
    const roomId = await pageA.getByTestId('room-id').innerText()
    expect(roomId).not.toBe('')

    await pageB.goto('/', { waitUntil: 'networkidle' })
    await pageB.getByRole('button', { name: '온라인', exact: true }).click()
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
    const before = await ownA.innerText()
    const mirroredA = pageB.locator(`[data-testid="network-player"][data-player-id="${ownPlayerId}"]`)
    const mirroredBefore = await mirroredA.innerText()

    await waitForOnlineScene(pageA)
    await pageA.bringToFront()
    await pageA.locator('canvas').click({ position: { x: 20, y: 20 } })
    await pageA.keyboard.down('KeyW')
    try {
      await expect.poll(async () => (
        (await ownA.innerText()) !== before && (await mirroredA.innerText()) !== mirroredBefore
      ), { timeout: INPUT_OBSERVATION_MS }).toBe(true)
    } finally {
      await pageA.keyboard.up('KeyW')
    }

    await pageB.getByRole('button', { name: '룸 나가기' }).click()
    await expect(pageA.getByTestId('player-count')).toContainText('참가자 1/6')
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
    await waitForOnlineScene(pageA)
    await waitForOnlineScene(pageB)

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

    // One authoritative match feeds both HUDs before the time-sensitive jump observation.
    await expect(pageA.getByTestId('online-alive')).toHaveText('2')
    await expect(pageB.getByTestId('online-alive')).toHaveText('2')
    await expect(pageA.getByTestId('online-eliminations')).toHaveText('0')
    await expect(pageB.getByTestId('online-eliminations')).toHaveText('0')
    await expect(pageA.getByTestId('online-lava')).toHaveText(LAVA_LABEL)
    await expect(pageB.getByTestId('online-lava')).toHaveText(LAVA_LABEL)
    await expect(pageA.getByTestId('online-winner')).toHaveCount(0)
    await expect(pageB.getByTestId('online-winner')).toHaveCount(0)

    await pageA.bringToFront()
    await pageA.locator('canvas').click({ position: { x: 20, y: 20 } })
    // The local edge stays queued until sent; poll only the server-owned acknowledgement.
    await pageA.keyboard.press('Space')
    await expect.poll(async () => (
      Number(await ownA.getAttribute('data-jump-ack'))
    ), { timeout: INPUT_OBSERVATION_MS, intervals: [100] }).toBeGreaterThan(initialJumpAck)
    const acknowledgedJump = Number(await ownA.getAttribute('data-jump-ack'))

    // The authoritative room, not the browser, applies gravity and the platform landing.
    await expect(ownA).toHaveAttribute('data-grounded', 'true')
    await expect.poll(async () => Math.abs(Number(await ownA.getAttribute('data-y')) - takeoffY)).toBeLessThan(0.1)
    await pageA.screenshot({ path: 'test-results/multiplayer-jump.png', fullPage: true })

    // Browser B receives the same takeoff receipt and synchronized landing.
    const mirroredJumper = pageB.locator(`[data-testid="network-player"][data-player-id="${jumperId}"]`)
    await expect(mirroredJumper).toHaveAttribute('data-jump-ack', String(acknowledgedJump))
    await expect(mirroredJumper).toHaveAttribute('data-grounded', 'true')
    await expect.poll(async () => Math.abs(Number(await mirroredJumper.getAttribute('data-y')) - takeoffY)).toBeLessThan(0.1)

    // The other browser never requested a jump, so its acknowledgement and pose stay unchanged.
    await expect(ownB).toHaveAttribute('data-jump-ack', '0')
    await expect(ownB).toHaveAttribute('data-grounded', 'true')
    await expect.poll(async () => Math.abs(Number(await ownB.getAttribute('data-y')) - idlerY)).toBeLessThan(0.05)

    const remainingA = clockSeconds(await pageA.getByTestId('online-timer').innerText())
    const remainingB = clockSeconds(await pageB.getByTestId('online-timer').innerText())
    expect(remainingA).toBeGreaterThan(0)
    expect(remainingA).toBeLessThan(clockBeforeJump)
    expect(Math.abs(remainingA - remainingB)).toBeLessThanOrEqual(1)
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
    await page.keyboard.down('e')
    try {
      await page.waitForTimeout(250)
      const schemaLink = { target: jumperId, incoming: rescuerId }
      let schemaObserved = false
      let domTargetObserved = false
      let domIncomingObserved = false
      let jumpSequence = 3
      for (let attempt = 0; attempt < 4 && (!schemaObserved || !domTargetObserved || !domIncomingObserved); attempt += 1) {
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
        const checks: PromiseSettledResult<void>[] = await Promise.allSettled([
          schemaObserved ? Promise.resolve() : expect.poll(() => ({
            target: room.state.players.get(rescuerId)?.grabTargetId ?? '',
            incoming: room.state.players.get(jumperId)?.grabbedById ?? '',
          }), { timeout: 1_200, intervals: [25] }).toEqual(schemaLink),
          domTargetObserved ? Promise.resolve() : expect.poll(
            () => rescuer.getAttribute('data-grab-target'),
            { timeout: 1_200, intervals: [25] },
          ).toBe(jumperId),
          domIncomingObserved ? Promise.resolve() : expect.poll(
            () => jumper.getAttribute('data-grabbed-by'),
            { timeout: 1_200, intervals: [25] },
          ).toBe(rescuerId),
        ])
        schemaObserved ||= checks[0].status === 'fulfilled'
        domTargetObserved ||= checks[1].status === 'fulfilled'
        domIncomingObserved ||= checks[2].status === 'fulfilled'
        if (!schemaObserved || !domTargetObserved || !domIncomingObserved) {
          await expect.poll(() => room.state.players.get(jumperId)?.grounded ?? false, {
            timeout: INPUT_OBSERVATION_MS,
            intervals: [50],
          }).toBe(true)
          jumpSequence += 2
        }
      }
      expect(schemaObserved).toBe(true)
      expect(domTargetObserved).toBe(true)
      expect(domIncomingObserved).toBe(true)
      const acknowledgedGrab = Number(await rescuer.getAttribute('data-grab-ack'))
      expect(acknowledgedGrab).toBeGreaterThan(initialGrabAck)
      await expect.poll(() => room.state.players.get(rescuerId)?.lastAcknowledgedGrab ?? 0, {
        timeout: INPUT_OBSERVATION_MS,
      }).toBe(acknowledgedGrab)
      await expect.poll(async () => Number(await rescuer.getAttribute('data-grip'))).toBeLessThan(1)
      // The target started to the rescuer's left; the room-owned pull must move it toward +X.
      expect(room.state.players.get(jumperId)?.x ?? rescueStartX).toBeGreaterThan(rescueStartX + 0.02)
    } finally {
      await page.keyboard.up('e')
    }

    await expect(rescuer).toHaveAttribute('data-grab-target', '', { timeout: INPUT_OBSERVATION_MS })
    await expect(jumper).toHaveAttribute('data-grabbed-by', '')
    await expect.poll(() => room.state.players.get(rescuerId)?.grabTargetId ?? 'missing', {
      timeout: INPUT_OBSERVATION_MS,
    }).toBe('')
    await expect(jumper).toHaveAttribute('data-grounded', 'true', { timeout: INPUT_OBSERVATION_MS })
    expect(pageErrors).toEqual([])
  } finally {
    await page.keyboard.up('e').catch(() => undefined)
    await room.leave(true).catch(() => undefined)
    await context.close()
  }
})
