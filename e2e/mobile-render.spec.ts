import { chromium, expect, test } from '@playwright/test'
import sharp from 'sharp'

test('mobile compositor presents colorful WebGL gameplay pixels', async () => {
  const browser = await chromium.launch({ executablePath: chromium.executablePath() })
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  })
  const page = await context.newPage()
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '봇 경기 시작' }).click()
  await expect(page.getByText('거대한 놀이터를 건너 탈출대로 올라가세요')).toBeVisible()

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
  expect(pageErrors).toEqual([])
  await browser.close()
})
