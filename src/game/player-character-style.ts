/** Pure, deterministic material and silhouette styling for the procedural climber. */
export type InfernalClimberOrnament = 'beacon' | 'fin' | 'broken' | 'flare'

export interface InfernalClimberStyleInput {
  playerId: string
  isOwn: boolean
  alive: boolean
  escaped: boolean
}

export interface InfernalClimberStyle {
  suit: number
  helmet: number
  accent: number
  emissive: number
  emissiveIntensity: number
  ornament: InfernalClimberOrnament
}

const ACCENTS = [0x5ee7ff, 0xb8ff6a, 0xff79d1, 0xffb64d, 0x9f8cff, 0x65ffc0] as const

/** FNV-1a over UTF-16 code units: tiny, stable, and independent of runtime hash randomization. */
function stablePlayerHash(playerId: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < playerId.length; index += 1) {
    hash ^= playerId.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function infernalClimberStyle(input: InfernalClimberStyleInput): InfernalClimberStyle {
  const accent = ACCENTS[stablePlayerHash(input.playerId) % ACCENTS.length]

  if (!input.alive) {
    return {
      suit: 0x352d38,
      helmet: 0x554854,
      accent,
      emissive: 0x321018,
      emissiveIntensity: 0.18,
      ornament: 'broken',
    }
  }

  if (input.escaped) {
    return {
      suit: 0x5b351f,
      helmet: 0xffd187,
      accent,
      emissive: 0xff5a12,
      emissiveIntensity: 2.15,
      ornament: 'flare',
    }
  }

  return {
    suit: input.isOwn ? 0xeee9f7 : 0x304557,
    helmet: input.isOwn ? 0xffffff : 0x91adba,
    accent,
    emissive: input.isOwn ? 0x8f4dff : accent,
    emissiveIntensity: input.isOwn ? 1.2 : 0.72,
    ornament: input.isOwn ? 'beacon' : 'fin',
  }
}
