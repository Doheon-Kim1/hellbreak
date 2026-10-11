import { expect, test } from '@playwright/test'
test.setTimeout(90000)

test('mobile settings pause local physics and touch jump still works when audio is unavailable', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3,
    isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => { Object.defineProperty(window, 'AudioContext', { value: class { constructor() { throw new Error('audio denied') } } }) })
  try {
    await page.goto('/', { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: '봇 경기 시작' }).tap()
    const canvas = page.locator('canvas')
    await expect(page.locator('.key-art')).toHaveCount(0, { timeout: 15000 })
    await expect(canvas).toHaveAttribute('data-local-grounded', 'true')
    const takeoffY = Number(await canvas.getAttribute('data-local-y'))
    // Open the real dialog on the first airborne sample, before slow browser round trips can land.
    await canvas.evaluate((node, baseline) => {
      const observer = new MutationObserver(() => {
        if (Number(node.getAttribute('data-local-y')) > baseline + 0.15) {
          observer.disconnect()
          document.querySelector<HTMLButtonElement>('.settings-trigger')!.click()
        }
      })
      observer.observe(node, { attributes: true, attributeFilter: ['data-local-y'] })
    }, takeoffY)
    await page.getByRole('button', { name: '점프', exact: true }).tap()
    await expect(page.getByRole('dialog', { name: '게임 설정' })).toBeVisible()
    const before = await canvas.getAttribute('data-local-y')
    expect(Number(before)).toBeGreaterThan(takeoffY + 0.1)
    const sample = Number(await canvas.getAttribute('data-local-position-sample'))
    await expect.poll(async () => Number(await canvas.getAttribute('data-local-position-sample')), { timeout: 15000 }).toBeGreaterThan(sample + 4)
    await expect(canvas).toHaveAttribute('data-local-y', before!)
    await page.screenshot({ path: 'test-results/playability-mobile-settings.png', fullPage: true })
    await page.getByRole('button', { name: '설정 닫기' }).tap()
    await expect(canvas).toHaveAttribute('data-local-grounded', 'true')
    await page.getByRole('button', { name: '점프', exact: true }).tap()
    await expect(canvas).toHaveAttribute('data-local-jump-ack', '2')
    expect(errors).toEqual([])
  } finally { await context.close() }
})

test('real audio graph emits sound and mutes its output', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    const evidence = { peak: 0, contexts: 0, channels: [] as number[] }
    Object.assign(window, { audioEvidence: evidence })
    const connect = AudioNode.prototype.connect
    AudioNode.prototype.connect = function (this: AudioNode, destination: AudioNode | AudioParam, ...args: number[]) {
      if (destination instanceof AudioDestinationNode) {
        const analyser = this.context.createAnalyser()
        analyser.fftSize = 256
        Reflect.apply(connect, this, [analyser])
        Reflect.apply(connect, analyser, [destination])
        const samples = new Float32Array(analyser.fftSize)
        const channel = evidence.channels.push(0) - 1
        setInterval(() => {
          analyser.getFloatTimeDomainData(samples)
          for (const sample of samples) {
            evidence.peak = Math.max(evidence.peak, Math.abs(sample))
            evidence.channels[channel] = Math.max(evidence.channels[channel], Math.abs(sample))
          }
        }, 10)
        evidence.contexts += 1
        return destination
      }
      return Reflect.apply(connect, this, [destination, ...args])
    } as typeof AudioNode.prototype.connect
  })
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.bringToFront()
  await page.getByRole('button', { name: '설정', exact: true }).click()
  await page.getByRole('button', { name: '효과음 미리 듣기' }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { audioEvidence: { peak: number } }).audioEvidence.peak))
    .toBeGreaterThan(0.00001)
  await page.getByRole('button', { name: '설정 닫기' }).click()
  await page.getByRole('button', { name: '봇 경기 시작' }).click()
  // Independently prove that the actual active lava-ambient output, not just the preview, emits.
  await expect.poll(() => page.evaluate(() => (window as unknown as { audioEvidence: { channels: number[] } }).audioEvidence.channels[1]))
    .toBeGreaterThan(0.00001)
  await page.getByRole('button', { name: '설정', exact: true }).click()
  await page.getByLabel('전체 음소거').check()
  await page.waitForTimeout(700)
  await page.evaluate(() => {
    const evidence = (window as unknown as { audioEvidence: { peak: number; channels: number[] } }).audioEvidence
    evidence.peak = 0
    evidence.channels.fill(0)
  })
  await page.getByRole('button', { name: '효과음 미리 듣기' }).click()
  await page.getByRole('button', { name: '설정 닫기' }).click()
  await page.waitForTimeout(700)
  expect(await page.evaluate(() => (window as unknown as { audioEvidence: { peak: number } }).audioEvidence.peak)).toBe(0)
  expect(await page.evaluate(() => (window as unknown as { audioEvidence: { channels: number[] } }).audioEvidence.channels)).toEqual([0, 0, 0])
  expect(errors).toEqual([])
})

test('local Space takes off, lands, and can jump again after restart', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '봇 경기 시작' }).click()
  const canvas = page.locator('canvas')
  await expect(page.locator('.key-art')).toHaveCount(0, { timeout: 15000 })
  await expect(canvas).toHaveAttribute('data-local-grounded', 'true')
  const before = Number(await canvas.getAttribute('data-local-y'))
  await canvas.evaluate((node) => {
    node.setAttribute('data-observed-peak', node.getAttribute('data-local-y') ?? '-100')
    const observer = new MutationObserver(() => {
      const y = Number(node.getAttribute('data-local-y'))
      if (y > Number(node.getAttribute('data-observed-peak'))) node.setAttribute('data-observed-peak', String(y))
    })
    observer.observe(node, { attributes: true, attributeFilter: ['data-local-y'] })
  })
  await page.keyboard.press('Space')
  await expect(canvas).toHaveAttribute('data-local-jump-ack', '1')
  await expect.poll(async () => Number(await canvas.getAttribute('data-observed-peak'))).toBeGreaterThan(before + 0.2)
  await expect(canvas).toHaveAttribute('data-local-grounded', 'true', { timeout: 5000 })
  const sampleBeforeRestart = Number(await canvas.getAttribute('data-local-position-sample'))
  await page.getByRole('button', { name: '경기 재시작' }).click()
  // Wait for new actual-body samples after restart, not the previous landing's cached flag.
  await expect.poll(async () => Number(await canvas.getAttribute('data-local-position-sample')))
    .toBeGreaterThan(sampleBeforeRestart + 4)
  await expect(canvas).toHaveAttribute('data-local-grounded', 'true')
  await page.keyboard.press('Space')
  await expect(canvas).toHaveAttribute('data-local-jump-ack', '2')
  expect(errors).toEqual([])
})

test('settings persist and editing controls cannot move or jump the online player', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '설정', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '게임 설정' })
  await expect(dialog).toBeVisible()
  await page.getByRole('slider', { name: '마우스 민감도' }).fill('0.5')
  await page.getByLabel('전체 음소거').check()
  await page.getByRole('button', { name: '설정 닫기' }).click()
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '설정', exact: true }).click()
  await expect(page.getByRole('slider', { name: '마우스 민감도' })).toHaveValue('0.5')
  await expect(page.getByLabel('전체 음소거')).toBeChecked()
  await page.getByRole('button', { name: '설정 닫기' }).click()
  await page.getByRole('button', { name: '온라인', exact: true }).click()
  await page.getByRole('button', { name: '온라인 룸 만들기' }).click()
  await expect(page.locator('.key-art')).toHaveCount(0, { timeout: 15000 })
  const own = page.locator('[data-testid="network-player"][data-own="true"]')
  await expect(own).toHaveAttribute('data-grounded', 'true')
  await expect(own).toHaveAttribute('data-alive', 'true')
  const before = await own.evaluate((node) => ({ x: node.getAttribute('data-x'), y: node.getAttribute('data-y'), z: node.getAttribute('data-z') }))
  const canvas = page.locator('canvas')
  await canvas.evaluate((node) => { (node as HTMLCanvasElement).dataset.pointerLockDenied = 'true' })
  const yawBeforeDrag = Number(await canvas.getAttribute('data-camera-yaw'))
  await canvas.dispatchEvent('mousedown', { button: 2, clientX: 100, clientY: 100 })
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mousemove', { clientX: 120, clientY: 100 })))
  await expect(canvas).toHaveAttribute('data-camera-yaw', (yawBeforeDrag - 20 * 0.0028 * 0.5).toFixed(6))
  // Opening settings while this right-drag is active must cancel it, before the live match ages.
  await page.getByRole('button', { name: '설정', exact: true }).click()
  const yawWhenOpened = await canvas.getAttribute('data-camera-yaw')
  const timeBefore = await page.getByTestId('online-timer').textContent()
  await own.evaluate((node) => {
    new MutationObserver(() => {
      if (Number(node.getAttribute('data-jump-ack')) > 0) node.setAttribute('data-observed-leaked-jump', 'true')
    }).observe(node, { attributes: true, attributeFilter: ['data-jump-ack'] })
  })
  await page.getByRole('slider', { name: '마우스 민감도' }).focus()
  await page.keyboard.press('Space')
  await page.keyboard.down('KeyW')
  // The real server's clock must advance before verifying the ACK and every position axis.
  await expect.poll(() => page.getByTestId('online-timer').textContent()).not.toBe(timeBefore)
  await page.keyboard.up('KeyW')
  await expect(own).toHaveAttribute('data-jump-ack', '0')
  await expect(own).not.toHaveAttribute('data-observed-leaked-jump', 'true')
  await expect(own).toHaveAttribute('data-x', before.x!)
  await expect(own).toHaveAttribute('data-y', before.y!)
  await expect(own).toHaveAttribute('data-z', before.z!)
  await expect(own).toHaveAttribute('data-alive', 'true')
  await page.getByRole('button', { name: '설정 닫기' }).click()
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mousemove', { clientX: 140, clientY: 100 })))
  await expect(canvas).toHaveAttribute('data-camera-yaw', yawWhenOpened!)
  await page.evaluate(() => window.dispatchEvent(new MouseEvent('mouseup', { button: 2 })))
})
