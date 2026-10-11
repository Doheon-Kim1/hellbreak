import { test, expect } from '@playwright/test'

test('native left mouse with W and Space mantles a real ledge and can jump again', async ({ page }, testInfo) => {
  // Software WebGL native input can take seconds per call; physical milestone deadlines remain bounded.
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.stack ?? error.message))
  await page.exposeFunction('ledgeGripObserved', () => page.keyboard.up('KeyW'))
  await page.addInitScript(() => {
    const history: { x: number; y: number; z: number; grounded: string; grip: string; ack: number; sample: string }[] = []
    Object.assign(window, { localGripHistory: history })
    let last = '', notified = false
    new MutationObserver(() => {
      const canvas = document.querySelector('canvas')
      if (!canvas || !canvas.dataset.localPositionSample || canvas.dataset.localPositionSample === last) return
      last = canvas.dataset.localPositionSample
      history.push({ x: Number(canvas.dataset.localX), y: Number(canvas.dataset.localY), z: Number(canvas.dataset.localZ),
        grounded: canvas.dataset.localGrounded ?? '', grip: canvas.dataset.localStructureGrip ?? '',
        ack: Number(canvas.dataset.localJumpAck ?? 0), sample: last })
      if (history.length > 2000) history.shift()
      if (canvas.dataset.localStructureGrip && !notified) {
        notified = true
        void (window as unknown as { ledgeGripObserved: () => Promise<void> }).ledgeGripObserved()
      }
    }).observe(document, { attributes: true, childList: true, subtree: true })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '봇 경기 시작', exact: true }).click()
  const canvas = page.locator('canvas')
  await expect(canvas).toHaveAttribute('data-scene-ready', 'true', { timeout: 30_000 })
  await expect(canvas).toHaveAttribute('data-local-grounded', 'true')
  await page.bringToFront()
  await canvas.click({ position: { x: 840, y: 420 } })
  await page.keyboard.press('KeyC')
  await page.waitForTimeout(150)
  await page.mouse.down()
  try {
    await page.keyboard.down('KeyW')
    try {
      await expect.poll(() => page.evaluate(() => Number(document.querySelector('canvas')!.dataset.localZ) < 20.7), { timeout: 15_000 }).toBe(true)
      await page.keyboard.press('Space')
      await expect.poll(() => page.evaluate(() => (window as unknown as { localGripHistory: { grip: string }[] })
        .localGripHistory.some(frame => frame.grip.startsWith('route-'))), { timeout: 15_000 }).toBe(true)
    } finally { await page.keyboard.up('KeyW') }
    await expect.poll(() => page.evaluate(() => {
      const c = document.querySelector('canvas')!
      return c.dataset.localStructureGrip === '' && c.dataset.localGrounded === 'true'
        && Number(c.dataset.localY) > -2 && Number(c.dataset.localZ) < 19.6 && Number(c.dataset.localZ) > 16.4
        && Number(c.dataset.localX) >= -25 && Number(c.dataset.localX) <= -19
    }), { timeout: 15_000 }).toBe(true)
  } catch (error) {
    await testInfo.attach('actual-local-grip-frames', { contentType: 'application/json', body: JSON.stringify(await page.evaluate(() => ({
      history: (window as unknown as { localGripHistory: unknown[] }).localGripHistory,
      dataset: { ...document.querySelector('canvas')!.dataset }, focus: document.hasFocus(),
    }))) })
    throw error
  } finally { await page.mouse.up() }
  const landing = await page.evaluate(() => {
    const c = document.querySelector('canvas')!
    return { y: Number(c.dataset.localY), ack: Number(c.dataset.localJumpAck ?? 0) }
  })
  await page.keyboard.press('Space')
  await expect.poll(() => page.evaluate(({ y, ack }) => (window as unknown as { localGripHistory: { y: number; ack: number }[] })
    .localGripHistory.some(frame => frame.y > y + 0.2 && frame.ack > ack), landing), { timeout: 10_000 }).toBe(true)
  expect(errors).toEqual([])
})

test('true-touch elimination keeps the spectator scene alive without reading a deleted Rapier body', async ({ browser }) => {
  test.setTimeout(180_000)
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.stack ?? error.message))
  try {
    await page.addInitScript(() => {
      const history: { x: number; y: number; z: number; sample: string }[] = []
      Object.assign(window, { mobileBodyHistory: history })
      let last = ''
      new MutationObserver(() => {
        const canvas = document.querySelector('canvas')
        if (!canvas?.dataset.localPositionSample || canvas.dataset.localPositionSample === last) return
        last = canvas.dataset.localPositionSample
        history.push({ x: Number(canvas.dataset.localX), y: Number(canvas.dataset.localY), z: Number(canvas.dataset.localZ), sample: last })
        if (history.length > 2000) history.shift()
      }).observe(document, { attributes: true, childList: true, subtree: true })
    })
    await page.goto('/')
    await page.getByRole('button', { name: '봇 경기 시작', exact: true }).tap()
    const canvas = page.locator('canvas')
    await expect(canvas).toHaveAttribute('data-scene-ready', 'true', { timeout: 30_000 })
    await expect(canvas).toHaveAttribute('data-scene-render-frame', /^[1-9]\d*$/)
    await expect(canvas).toHaveAttribute('data-local-grounded', 'true')
    await expect(page.getByRole('button', { name: '턱 잡기', exact: true })).toBeVisible()
    const start = await canvas.evaluate(element => ({ x: Number(element.dataset.localX), y: Number(element.dataset.localY), z: Number(element.dataset.localZ) }))
    // GiantPlayground's actual base floor spans [-45,45] in X/Z. Walk past it;
    // a stationary player dying to rising lava must not satisfy this regression.
    const cdp = await context.newCDPSession(page)
    const backward = await page.getByRole('button', { name: '뒤로 이동', exact: true }).boundingBox()
    expect(backward).not.toBeNull()
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{
      x: backward!.x + backward!.width / 2, y: backward!.y + backward!.height / 2, id: 1,
    }] })
    try {
      await expect.poll(() => page.evaluate(({ x, z }) => (window as unknown as { mobileBodyHistory: { x: number; y: number; z: number }[] })
        .mobileBodyHistory.some(pose => Math.hypot(pose.x - x, pose.z - z) > 2), start), { timeout: 15_000 }).toBe(true)
      await expect.poll(() => page.evaluate(({ y }) => (window as unknown as { mobileBodyHistory: { x: number; y: number; z: number }[] })
        .mobileBodyHistory.some(pose => (Math.abs(pose.x) > 45.5 || Math.abs(pose.z) > 45.5) && pose.y < y - 0.3), start), { timeout: 45_000 }).toBe(true)
      await expect(page.getByLabel('관전 대상 변경')).toBeVisible({ timeout: 20_000 })
    } finally { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }) }
    const before = Number(await canvas.getAttribute('data-scene-render-frame'))
    await expect.poll(async () => Number(await canvas.getAttribute('data-scene-render-frame')), { timeout: 10_000 }).toBeGreaterThan(before + 2)
    await expect(page.getByRole('button', { name: '봇 경기 시작', exact: true })).toHaveCount(0)
    await expect(page.locator('canvas')).toHaveAttribute('data-scene-ready', 'true')
    await page.getByRole('button', { name: '설정', exact: true }).tap()
    await page.getByRole('button', { name: '설정 닫기', exact: true }).tap()
    expect(errors).toEqual([])
  } finally { await context.close() }
})
