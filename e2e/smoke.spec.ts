import { expect, test } from '@playwright/test'

test('loads the HELLBREAK playground and starts the new danger loop', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'HELL BREAK' })).toBeVisible()
  await expect(page.getByText('NEXT.JS 로컬 게임 실행 중')).toBeVisible()
  await expect(page.getByText(/폭주 그네와 붕괴 구름다리/)).toBeVisible()
  await expect(page.locator('canvas')).toBeVisible()

  await page.getByRole('button', { name: '봇 경기 시작' }).click()
  await expect(page.locator('.key-art')).toHaveCount(0, { timeout: 15_000 })
  await expect(page.locator('.danger-chip')).toContainText('그네 폭주')
  await expect(page.locator('.lava-chip')).toContainText('용암')
  expect(errors).toEqual([])
})

test('keeps a full-height visible 3D viewport and controls on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: '봇 경기 시작' }).click()

  await expect(page.locator('.key-art')).toHaveCount(0, { timeout: 15_000 })
  await expect(page.locator('.mobile-controls')).toBeVisible()
  await expect(page.getByRole('button', { name: '능력 사용' })).toBeVisible()

  const canvasBox = await page.locator('canvas').boundingBox()
  expect(canvasBox?.width).toBe(390)
  expect(canvasBox?.height).toBe(844)
  await expect(page.locator('.scene-error')).toHaveCount(0)
})
