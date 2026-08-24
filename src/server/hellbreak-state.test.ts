import { expect, it } from 'vitest'
import { PlayerSchema } from './hellbreak-state'

it('appends structure grip without shifting the existing player wire indices', () => {
  const metadataSymbol = Object.getOwnPropertySymbols(PlayerSchema)
    .find((symbol) => String(symbol) === 'Symbol(Symbol.metadata)')
  expect(metadataSymbol).toBeDefined()

  const metadata = PlayerSchema[metadataSymbol as keyof typeof PlayerSchema] as unknown as Record<
    string,
    { index: number; name: string; type: string }
  >
  expect(Object.values(metadata).map(({ index, name, type }) => [index, name, type])).toEqual([
    [0, 'id', 'string'],
    [1, 'x', 'number'],
    [2, 'y', 'number'],
    [3, 'z', 'number'],
    [4, 'velocityY', 'number'],
    [5, 'grounded', 'boolean'],
    [6, 'alive', 'boolean'],
    [7, 'escaped', 'boolean'],
    [8, 'lastProcessedInput', 'number'],
    [9, 'lastAcknowledgedJump', 'number'],
    [10, 'grabTargetId', 'string'],
    [11, 'grabbedById', 'string'],
    [12, 'grip', 'number'],
    [13, 'lastAcknowledgedGrab', 'number'],
    [14, 'structureGripAnchorId', 'string'],
  ])
})
