import { expect, test } from '@playwright/test'
import sharp from 'sharp'

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
})
test.describe.configure({ timeout: 60_000 })

test('mobile compositor presents colorful WebGL gameplay pixels', async ({ page, context }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '봇 경기 시작' }).click()
  await expect(page.locator('.danger-chip')).toContainText('그네 폭주', { timeout: 15_000 })

  const canvasWrapperHeight = await page.locator('canvas').evaluate((canvas) => (
    canvas.parentElement?.getBoundingClientRect().height ?? 0
  ))
  expect(canvasWrapperHeight).toBeGreaterThan(800)

  const canvasBox = await page.locator('canvas').boundingBox()
  expect(canvasBox).not.toBeNull()
  await page.waitForTimeout(1_000)

  const screenshot = await page.screenshot()
  const metadata = await sharp(screenshot).metadata()
  const scaleX = metadata.width! / 390
  const scaleY = metadata.height! / 844
  const box = canvasBox!
  const sample = await sharp(screenshot)
    .extract({
      left: Math.floor((box.x + box.width * 0.35) * scaleX),
      top: Math.floor((box.y + box.height * 0.35) * scaleY),
      width: Math.max(1, Math.floor(box.width * 0.3 * scaleX)),
      height: Math.max(1, Math.floor(box.height * 0.3 * scaleY)),
    })
    .removeAlpha()
    .raw()
    .toBuffer()

  let colorfulPixels = 0
  for (let index = 0; index < sample.length; index += 3) {
    const red = sample[index]
    const green = sample[index + 1]
    const blue = sample[index + 2]
    if (Math.max(red, green, blue) - Math.min(red, green, blue) > 35 && Math.max(red, green, blue) > 55) {
      colorfulPixels += 1
    }
  }

  expect(colorfulPixels / (sample.length / 3)).toBeGreaterThan(0.08)

  const beforeDrag = await sharp(screenshot).removeAlpha().raw().toBuffer()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: 305, y: 410, id: 1, radiusX: 4, radiusY: 4, force: 1 }],
  })
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: 95, y: 330, id: 1, radiusX: 4, radiusY: 4, force: 1 }],
  })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(1_000)

  const afterDrag = await sharp(await page.screenshot()).removeAlpha().raw().toBuffer()
  let changedPixels = 0
  for (let index = 0; index < beforeDrag.length; index += 3) {
    const difference = Math.abs(beforeDrag[index] - afterDrag[index])
      + Math.abs(beforeDrag[index + 1] - afterDrag[index + 1])
      + Math.abs(beforeDrag[index + 2] - afterDrag[index + 2])
    if (difference > 60) changedPixels += 1
  }

  expect(changedPixels / (beforeDrag.length / 3)).toBeGreaterThan(0.2)
  await expect(page.getByRole('button', { name: '능력 사용' })).toBeVisible()
  expect(pageErrors).toEqual([])
})
