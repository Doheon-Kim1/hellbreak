import { expect, test } from '@playwright/test'

// Software WebGL trace measured 2–9s per native UI operation; keep semantic waits tight.
test.setTimeout(180000)
test('lava BGM emits independently, pauses, mutes, and remembers its own volume', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    const evidence = { channels: [] as number[], buffers: [] as { length: number; duration: number; loop: boolean }[] }
    Object.assign(window, { lavaAudioEvidence: evidence })
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
          for (const sample of samples) evidence.channels[channel] = Math.max(evidence.channels[channel], Math.abs(sample))
        }, 10)
        return destination
      }
      return Reflect.apply(connect, this, [destination, ...args])
    } as typeof AudioNode.prototype.connect
    const start = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...args: number[]) {
      evidence.buffers.push({ length: this.buffer?.length ?? 0, duration: this.buffer?.duration ?? 0, loop: this.loop })
      return Reflect.apply(start, this, args)
    }
  })
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.bringToFront()
  await page.getByRole('button', { name: '설정', exact: true }).click()
  const music = page.getByRole('slider', { name: '용암 BGM 볼륨', exact: true })
  await expect(music).toHaveValue('0.45')
  await page.getByRole('slider', { name: '효과음 볼륨' }).fill('0')
  await page.getByRole('slider', { name: '용암 배경음 볼륨' }).fill('0')
  const levels = () => page.evaluate(() => (window as unknown as {
    lavaAudioEvidence: { channels: number[] }
  }).lavaAudioEvidence.channels)
  const clear = () => page.evaluate(() => (window as unknown as {
    lavaAudioEvidence: { channels: number[] }
  }).lavaAudioEvidence.channels.fill(0))
  await page.getByRole('button', { name: '설정 닫기' }).click()
  await page.getByRole('button', { name: '봇 경기 시작' }).click()
  await expect(page.locator('canvas')).toHaveAttribute('data-scene-ready', 'true', { timeout: 20000 })
  await clear()
  await expect.poll(async () => (await levels())[2]).toBeGreaterThan(0.00001)
  expect((await levels()).slice(0, 2)).toEqual([0, 0])
  const buffers = await page.evaluate(() => (window as unknown as {
    lavaAudioEvidence: { buffers: { length: number; duration: number; loop: boolean }[] }
  }).lavaAudioEvidence.buffers)
  expect(buffers.filter(buffer => buffer.loop && buffer.duration >= 15)).toHaveLength(1)

  await page.getByRole('button', { name: '설정', exact: true }).click()
  await page.waitForTimeout(100)
  await clear()
  await page.waitForTimeout(250)
  expect(await levels()).toEqual([0, 0, 0])
  await page.getByRole('button', { name: '설정 닫기' }).click()
  await clear()
  await expect.poll(async () => (await levels())[2]).toBeGreaterThan(0.00001)
  await page.getByRole('button', { name: '설정', exact: true }).click()
  await music.fill('0')
  await page.getByRole('button', { name: '설정 닫기' }).click()
  await clear()
  await page.waitForTimeout(250)
  expect(await levels()).toEqual([0, 0, 0])

  await page.getByRole('button', { name: '설정', exact: true }).click()
  await music.fill('0.37')
  await page.getByLabel('전체 음소거').check()
  await page.getByRole('button', { name: '설정 닫기' }).click()
  await clear()
  await page.waitForTimeout(250)
  expect(await levels()).toEqual([0, 0, 0])
  // Real active movement sampling excludes vacuous silence from a finished/paused game.
  await expect(page.locator('canvas')).toHaveAttribute('data-local-grounded', 'true')
  const sample = Number(await page.locator('canvas').getAttribute('data-local-position-sample'))
  await expect.poll(async () => Number(await page.locator('canvas').getAttribute('data-local-position-sample'))).toBeGreaterThan(sample)
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '설정', exact: true }).click()
  await expect(music).toHaveValue('0.37')
  await expect(page.getByLabel('전체 음소거')).toBeChecked()
  await page.getByLabel('전체 음소거').uncheck()
  await page.getByRole('button', { name: '설정 닫기' }).click()
  await page.getByRole('button', { name: '봇 경기 시작' }).click()
  await clear()
  await expect.poll(async () => (await levels())[2]).toBeGreaterThan(0.00001)
  expect((await levels()).slice(0, 2)).toEqual([0, 0])
  expect(errors).toEqual([])
})

test('touch settings expose an independently adjustable BGM slider without blocking play', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 },
    isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce' })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.goto('/', { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: '설정', exact: true }).tap()
    const music = page.getByRole('slider', { name: '용암 BGM 볼륨', exact: true })
    await music.scrollIntoViewIfNeeded()
    await expect(music).toBeVisible()
    await music.tap()
    await expect(music).not.toHaveValue('0.45')
    await music.fill('0.21')
    await expect(music).toHaveValue('0.21')
    const box = await music.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(390)
    await page.screenshot({ path: 'test-results/mobile-lava-music.png', fullPage: true })
    await page.getByRole('button', { name: '설정 닫기' }).tap()
    await page.getByRole('button', { name: '봇 경기 시작' }).tap()
    await expect(page.locator('canvas')).toHaveAttribute('data-scene-ready', 'true', { timeout: 20000 })
    await expect(page.locator('canvas')).toHaveAttribute('data-local-grounded', 'true')
    expect(errors).toEqual([])
  } finally { await context.close() }
})
