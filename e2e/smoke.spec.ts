import { expect, test } from '@playwright/test'

test('loads the HELLBREAK 3D prototype without browser errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'HELLBREAK' })).toBeVisible()
  await expect(page.getByText('LOCAL PROTOTYPE ONLINE')).toBeVisible()
  await expect(page.locator('canvas')).toBeVisible()
  expect(errors).toEqual([])
})
