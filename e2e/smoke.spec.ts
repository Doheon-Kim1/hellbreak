import { expect, test } from '@playwright/test'

test('loads the HELLBREAK 3D prototype without browser errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'HELL BREAK' })).toBeVisible()
  await expect(page.getByText('NEXT.JS 로컬 게임 실행 중')).toBeVisible()
  await expect(page.getByText('거대한 미끄럼틀, 정글짐, 그네와 구름다리를 건너')).toBeVisible()
  await expect(page.locator('canvas')).toBeVisible()

  await page.getByRole('button', { name: '봇 경기 시작' }).click()
  await expect(page.getByText('거대한 놀이터를 건너 탈출대로 올라가세요')).toBeVisible()
  expect(errors).toEqual([])
})
