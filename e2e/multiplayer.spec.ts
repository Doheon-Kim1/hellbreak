import { expect, test } from '@playwright/test'

test('two browsers create, join, synchronize movement, and leave a room', async ({ browser }) => {
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()
  const pageErrors: string[] = []
  pageA.on('pageerror', (error) => pageErrors.push(`A: ${error.message}`))
  pageB.on('pageerror', (error) => pageErrors.push(`B: ${error.message}`))

  try {
    await pageA.goto('/', { waitUntil: 'networkidle' })
    await pageA.getByRole('button', { name: '온라인', exact: true }).click()
    await pageA.getByRole('button', { name: '온라인 룸 만들기' }).click()
    await expect(pageA.getByTestId('player-count')).toContainText('참가자 1/6')
    const roomId = await pageA.getByTestId('room-id').innerText()
    expect(roomId).not.toBe('')

    await pageB.goto('/', { waitUntil: 'networkidle' })
    await pageB.getByRole('button', { name: '온라인', exact: true }).click()
    await pageB.getByLabel('룸 ID').fill(roomId)
    await pageB.getByRole('button', { name: '참가', exact: true }).click()

    await expect(pageA.getByTestId('player-count')).toContainText('참가자 2/6')
    await expect(pageB.getByTestId('player-count')).toContainText('참가자 2/6')
    await expect(pageA.getByTestId('network-player')).toHaveCount(2)
    await expect(pageB.getByTestId('network-player')).toHaveCount(2)
    await pageA.screenshot({ path: 'test-results/multiplayer-connected.png', fullPage: true })

    const ownA = pageA.locator('[data-testid="network-player"][data-own="true"]')
    const ownPlayerId = await ownA.getAttribute('data-player-id')
    expect(ownPlayerId).toBeTruthy()
    const before = await ownA.innerText()
    const mirroredA = pageB.locator(`[data-testid="network-player"][data-player-id="${ownPlayerId}"]`)
    const mirroredBefore = await mirroredA.innerText()

    await pageA.bringToFront()
    await pageA.locator('canvas').click({ position: { x: 20, y: 20 } })
    await pageA.keyboard.down('KeyW')
    await pageA.waitForTimeout(450)
    await pageA.keyboard.up('KeyW')
    await expect(ownA).not.toHaveText(before)
    await expect(mirroredA).not.toHaveText(mirroredBefore)

    await pageB.getByRole('button', { name: '룸 나가기' }).click()
    await expect(pageA.getByTestId('player-count')).toContainText('참가자 1/6')
    expect(pageErrors).toEqual([])
  } finally {
    await contextA.close()
    await contextB.close()
  }
})
