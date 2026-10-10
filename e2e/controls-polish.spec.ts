import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { DEFAULT_CAMERA_ORBIT } from '../src/game/camera'
test.setTimeout(120000)
async function startLocal(page: Page) {
  await page.setViewportSize({ width: 960, height: 640 })
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '봇 경기 시작' }).click()
  await expect(page.locator('.key-art')).toHaveCount(0, { timeout: 20000 })
}
async function look(page: Page, dx: number) {
  // Chromium does not reliably emit raw locked movementX for page.mouse.move().
  // Only bounded look deltas are synthetic; lock acquisition remains a real browser gesture.
  await page.evaluate((delta) => {
    const event = new MouseEvent('mousemove', { bubbles: true })
    Object.defineProperty(event, 'movementX', { value: delta })
    Object.defineProperty(event, 'movementY', { value: 0 })
    document.dispatchEvent(event)
  }, dx)
}

test('bottom key guide can be hidden, restored, and remembered', async ({ page }) => {
  await startLocal(page)
  const guide = page.getByRole('region', { name: '조작 가이드' })
  await expect(guide).toBeVisible()
  await expect(guide).toContainText('WASD')
  await expect(guide).toContainText('Space')
  const bounds = await guide.boundingBox()
  expect(bounds!.y).toBeGreaterThan(640 / 2)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(641)
  await page.getByRole('button', { name: '설정', exact: true }).click()
  await page.getByLabel('하단 조작 가이드 표시').uncheck()
  await page.getByRole('button', { name: '설정 닫기' }).click()
  await expect(guide).toHaveCount(0)
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '설정', exact: true }).click()
  await expect(page.getByLabel('하단 조작 가이드 표시')).not.toBeChecked()
  await page.getByLabel('하단 조작 가이드 표시').check()
  await page.getByRole('button', { name: '설정 닫기' }).click()
  await page.getByRole('button', { name: '봇 경기 시작' }).click()
  await expect(guide).toBeVisible()
  await page.screenshot({ path: 'test-results/bottom-key-guide.png', fullPage: true })
})

test('mouse look stays responsive while grabbing and immediately after C reset', async ({ page }) => {
  await startLocal(page)
  const canvas = page.locator('canvas')
  await page.getByRole('button', { name: '마우스 조작 시작' }).click()
  await expect(canvas).toHaveAttribute('data-pointer-locked', 'true')
  // Past the deliberate 100ms acquisition-warp guard, inject the bounded look intent below.
  await page.waitForTimeout(150)
  await look(page, 2)
  await canvas.dispatchEvent('mousedown', { button: 0 })
  await expect(canvas).toHaveAttribute('data-grab-held', 'true')
  const heldYaw = Number(await canvas.getAttribute('data-camera-yaw'))
  await look(page, 20)
  await expect.poll(async () => Math.abs(Number(await canvas.getAttribute('data-camera-yaw')) - heldYaw)).toBeGreaterThan(0.01)
  await expect(canvas).toHaveAttribute('data-grab-held', 'true')
  await canvas.dispatchEvent('mouseup', { button: 0 })
  const resets = Number(await canvas.getAttribute('data-camera-reset') ?? '0')
  await page.keyboard.press('KeyC')
  await expect(canvas).toHaveAttribute('data-camera-reset', String(resets + 1))
  await expect(canvas).toHaveAttribute('data-camera-yaw', DEFAULT_CAMERA_ORBIT.yaw.toFixed(6))
  await expect(canvas).toHaveAttribute('data-camera-pitch', DEFAULT_CAMERA_ORBIT.pitch.toFixed(6))
  const resetYaw = Number(await canvas.getAttribute('data-camera-yaw'))
  await look(page, 20)
  await expect.poll(async () => Math.abs(Number(await canvas.getAttribute('data-camera-yaw')) - resetYaw)).toBeGreaterThan(0.01)
  await page.evaluate(() => document.exitPointerLock())
  await expect(canvas).toHaveAttribute('data-pointer-locked', 'false')
  const freeYaw = Number(await canvas.getAttribute('data-camera-yaw'))
  await canvas.dispatchEvent('mousemove', { movementX: 20, movementY: 0, bubbles: true })
  await expect.poll(async () => Math.abs(Number(await canvas.getAttribute('data-camera-yaw')) - freeYaw)).toBeGreaterThan(0.01)
  await page.keyboard.press('KeyC')
  await expect(canvas).toHaveAttribute('data-camera-reset', String(resets + 2))
  await expect(canvas).toHaveAttribute('data-camera-yaw', DEFAULT_CAMERA_ORBIT.yaw.toFixed(6))
  await expect(canvas).toHaveAttribute('data-camera-pitch', DEFAULT_CAMERA_ORBIT.pitch.toFixed(6))
})

test('walking off the spawn reaches the actual floor and permits repeated real jumps', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await startLocal(page)
  const canvas = page.locator('canvas')
  await expect(canvas).toHaveAttribute('data-local-grounded', 'true')
  await page.evaluate(() => {
    const element = document.querySelector<HTMLCanvasElement>('.viewport canvas')!
    const result = { triggerX: NaN, triggerY: NaN, triggerZ: NaN, peak: -Infinity, secondPeak: -Infinity, sample: 0 }
    Object.assign(window, { floorJump: result })
    new MutationObserver(() => {
      const y = Number(element.dataset.localY)
      const x = Number(element.dataset.localX), z = Number(element.dataset.localZ)
      if (Number.isNaN(result.triggerY) && y < -2.5 && y > -2.56
          && x > -32 && x < -26 && z > 23.6 && z < 29 && element.dataset.localGrounded === 'true') {
        result.triggerX = x
        result.triggerY = y
        result.triggerZ = z
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyS', bubbles: true }))
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }))
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', bubbles: true }))
      }
      if (!Number.isNaN(result.triggerY)) {
        result.peak = Math.max(result.peak, y)
        if (Number(element.dataset.localJumpAck) >= 2) result.secondPeak = Math.max(result.secondPeak, y)
        result.sample = Number(element.dataset.localPositionSample)
      }
    }).observe(element, { attributes: true, attributeFilter: ['data-local-position-sample'] })
  })
  await page.keyboard.down('s')
  await expect.poll(() => page.evaluate(() => (window as unknown as { floorJump: { triggerZ: number } }).floorJump.triggerZ), { timeout: 10000 }).toBeGreaterThan(23.6)
  await page.keyboard.up('s')
  const landed = await page.evaluate(() => (window as unknown as { floorJump: {
    triggerX: number; triggerY: number; triggerZ: number } }).floorJump)
  expect([landed.triggerX, landed.triggerY, landed.triggerZ].every(Number.isFinite)).toBe(true)
  expect(landed.triggerX).toBeGreaterThan(-32)
  expect(landed.triggerX).toBeLessThan(-26)
  expect(landed.triggerY).toBeCloseTo(-2.53, 1)
  expect(landed.triggerZ).toBeGreaterThan(23.6)
  expect(landed.triggerZ).toBeLessThan(29)
  await expect(canvas).toHaveAttribute('data-local-jump-ack', '1', { timeout: 8000 })
  await expect.poll(() => page.evaluate(() => {
    const result = (window as unknown as { floorJump: { peak: number; triggerY: number } }).floorJump
    return result.peak - result.triggerY
  })).toBeGreaterThan(0.3)
  await expect(canvas).toHaveAttribute('data-local-grounded', 'true', { timeout: 10000 })
  await page.keyboard.press('Space')
  await expect(canvas).toHaveAttribute('data-local-jump-ack', '2')
  await expect.poll(() => page.evaluate(() => {
    const result = (window as unknown as { floorJump: { secondPeak: number; triggerY: number } }).floorJump
    return result.secondPeak - result.triggerY
  })).toBeGreaterThan(0.3)
  expect(errors).toEqual([])
})

test('forward jump climbs the first visible foothold without first correcting the camera', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await startLocal(page)
  const canvas = page.locator('canvas')
  const gameBounds = (await page.locator('.viewport').boundingBox())!
  expect(gameBounds.width).toBeGreaterThan(page.viewportSize()!.width * 0.95)
  await expect(page.locator('.hud h1')).toBeHidden()
  await expect(canvas).toHaveAttribute('data-local-grounded', 'true')
  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas')!
    const startY = Number(canvas.dataset.localY)
    const proof = { landed: false, x: 0, y: 0, z: 0, peak: startY, startY }
    Object.assign(window, { firstClimb: proof })
    new MutationObserver(() => {
      const x = Number(canvas.dataset.localX), y = Number(canvas.dataset.localY), z = Number(canvas.dataset.localZ)
      proof.peak = Math.max(proof.peak, y)
      if (!proof.landed && y > startY + 0.45 && x > -25 && x < -19 && z > 16.4 && z < 19.6
          && canvas.dataset.localGrounded === 'true') {
        Object.assign(proof, { landed: true, x, y, z })
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }))
      }
    }).observe(canvas, { attributes: true, attributeFilter: ['data-local-position-sample'] })
    // Normal game intent in one turn keeps software rendering from separating the two key edges.
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }))
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', bubbles: true }))
  })
  await expect.poll(() => page.evaluate(() => (window as unknown as { firstClimb: { landed: boolean } }).firstClimb.landed), { timeout: 10000 }).toBe(true)
  await expect(canvas).toHaveAttribute('data-local-jump-ack', '1')
  await page.screenshot({ path: 'test-results/first-playable-climb.png', fullPage: true })
  expect(errors).toEqual([])
})

test('true touch mobile shows a non-overlapping bottom guide and can hide it', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 },
    isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce' })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.goto('/', { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: '봇 경기 시작' }).tap()
    await expect(page.locator('.key-art')).toHaveCount(0, { timeout: 20000 })
    const guide = page.getByRole('region', { name: '조작 가이드' })
    await expect(guide).toBeVisible()
    await expect(guide.locator('.touch-guide')).toBeVisible()
    await expect(guide.locator('.keyboard-guide')).toBeHidden()
    const guideBounds = (await guide.boundingBox())!
    const touchBounds = (await page.locator('.mobile-controls').boundingBox())!
    expect(guideBounds.y).toBeGreaterThan(422)
    expect(guideBounds.y + guideBounds.height).toBeLessThanOrEqual(touchBounds.y)
    await page.screenshot({ path: 'test-results/mobile-bottom-guide.png', fullPage: true })
    await page.getByRole('button', { name: '설정', exact: true }).tap()
    await page.getByLabel('하단 조작 가이드 표시').uncheck()
    await page.getByRole('button', { name: '설정 닫기' }).tap()
    await expect(guide).toHaveCount(0)
    expect(errors).toEqual([])
  } finally { await context.close() }
})
