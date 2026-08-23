import { expect, test } from '@playwright/test'

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
})

test('mobile touch and reduced motion keep the local articulated scene healthy', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')

  await page.getByRole('button', { name: '봇 경기 시작' }).click()
  await expect(page.locator('.key-art')).toHaveCount(0, { timeout: 15_000 })
  await expect(page.locator('canvas')).toBeVisible()
  await expect(page.locator('.scene-error')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches))
    .toBe(true)
  await page.waitForTimeout(800)

  expect(pageErrors).toEqual([])
})
