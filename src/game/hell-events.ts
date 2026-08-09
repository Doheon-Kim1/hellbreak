export type HellEventKind = 'swing-frenzy' | 'bridge-collapse' | 'slide-fire' | 'lava-boost'
export type HellEventPhase = 'warning' | 'active' | 'cooldown'
export type RunnerAbility = 'rocket-boots' | 'spring-shoes' | 'extinguisher'

export interface HellEventState {
  kind: HellEventKind
  phase: HellEventPhase
  secondsRemaining: number
  label: string
}

export interface AbilitySpec {
  label: string
  color: string
  speedMultiplier: number
  jumpMultiplier: number
  durationSeconds: number
  charges: number
  lavaBlocks: number
}

const EVENT_KINDS: readonly HellEventKind[] = [
  'swing-frenzy',
  'bridge-collapse',
  'slide-fire',
  'lava-boost',
]

const EVENT_LABELS: Record<HellEventKind, string> = {
  'swing-frenzy': '그네 폭주',
  'bridge-collapse': '구름다리 붕괴',
  'slide-fire': '미끄럼틀 화염',
  'lava-boost': '용암 가속',
}

const ABILITIES: Record<RunnerAbility, AbilitySpec> = {
  'rocket-boots': {
    label: '로켓 운동화',
    color: '#7cf7ff',
    speedMultiplier: 1.55,
    jumpMultiplier: 1,
    durationSeconds: 5,
    charges: 1,
    lavaBlocks: 0,
  },
  'spring-shoes': {
    label: '스프링 신발',
    color: '#b3ff6f',
    speedMultiplier: 1,
    jumpMultiplier: 1.55,
    durationSeconds: 0,
    charges: 1,
    lavaBlocks: 0,
  },
  extinguisher: {
    label: '소화기',
    color: '#ff8168',
    speedMultiplier: 1,
    jumpMultiplier: 1,
    durationSeconds: 0,
    charges: 1,
    lavaBlocks: 1,
  },
}

export function hellEventAt(elapsedSeconds: number): HellEventState {
  const safeElapsed = Math.max(0, Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0)
  const eventIndex = Math.floor(safeElapsed / 20) % EVENT_KINDS.length
  const eventTime = safeElapsed % 20
  const phase: HellEventPhase = eventTime < 4
    ? 'warning'
    : eventTime < 12
      ? 'active'
      : 'cooldown'
  const phaseEnd = phase === 'warning' ? 4 : phase === 'active' ? 12 : 20
  const kind = EVENT_KINDS[eventIndex]

  return {
    kind,
    phase,
    secondsRemaining: phaseEnd - eventTime,
    label: EVENT_LABELS[kind],
  }
}

/**
 * Inert event for server-authoritative online play. `room-simulation` collides against
 * the fixed PLAYGROUND_ROUTE surfaces and never reacts to hell events, so the online
 * client must not remove or move anything the server keeps solid. `GiantPlayground`
 * gates every geometry change on `phase === 'active'` (and the route 8-10 bridge drop
 * additionally on the collapse kind), so this cooldown `lava-boost` state renders the
 * full authoritative route with no moving hazards. Local bot matches keep `hellEventAt`.
 */
export function authoritativeHellEvent(): HellEventState {
  return {
    kind: 'lava-boost',
    phase: 'cooldown',
    secondsRemaining: 0,
    label: EVENT_LABELS['lava-boost'],
  }
}

export function wardenLavaBonusAt(elapsedSeconds: number): number {
  const elapsed = Math.max(0, Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0)
  const firstBoostStart = 64
  const eventCycleSeconds = 80
  const boostDuration = 8
  const boostHeight = 0.75
  if (elapsed <= firstBoostStart) return 0

  const sinceFirstBoost = elapsed - firstBoostStart
  const completedBoosts = Math.floor(sinceFirstBoost / eventCycleSeconds)
  const activeBoostProgress = Math.min(1, (sinceFirstBoost % eventCycleSeconds) / boostDuration)
  return (completedBoosts + activeBoostProgress) * boostHeight
}

export function abilitySpec(ability: RunnerAbility): AbilitySpec {
  return ABILITIES[ability]
}

export function pickupAbility(_held: RunnerAbility | null, pickup: RunnerAbility): RunnerAbility {
  return pickup
}
