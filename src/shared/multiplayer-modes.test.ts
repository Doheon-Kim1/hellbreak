import { describe, expect, it } from 'vitest'
import {
  hiveCapabilityEndpoint,
  parseHiveCapability,
  readClientBuildFlags,
  resolveMultiplayerModes,
  shouldProbeHiveCapability,
} from './multiplayer-modes'
import type { MultiplayerCapabilityInput } from './multiplayer-modes'

const SERVER_BUILD: MultiplayerCapabilityInput = {
  staticExport: false,
  hiveLoginWired: true,
  serverCapability: { configured: true, blockers: [] },
  roomEndpointConfigured: true,
}

const PAGES_BUILD: MultiplayerCapabilityInput = {
  staticExport: true,
  hiveLoginWired: false,
  serverCapability: null,
  roomEndpointConfigured: true,
}

describe('guest demo mode', () => {
  it('stays available on the static Pages build, which is the whole point of the fallback', () => {
    const { guest } = resolveMultiplayerModes(PAGES_BUILD)

    expect(guest.available).toBe(true)
    expect(guest.blocker).toBe(null)
    expect(guest.explanation).toBe(null)
  })

  it('is unavailable, with a reason, when no room server address is configured', () => {
    const { guest } = resolveMultiplayerModes({ ...PAGES_BUILD, roomEndpointConfigured: false })

    expect(guest.available).toBe(false)
    expect(guest.blocker).toBe('room-endpoint-missing')
    expect(guest.explanation).toMatch(/룸 서버 주소/)
  })

  it('does not depend on HIVE configuration in either direction', () => {
    const withoutHive = resolveMultiplayerModes({
      ...SERVER_BUILD,
      serverCapability: { configured: false, blockers: ['HIVE_APP_ID'] },
    })

    expect(withoutHive.guest.available).toBe(true)
    expect(withoutHive.hive.available).toBe(false)
  })
})

describe('HIVE authenticated queue mode', () => {
  it('is available only when the build, the login flow, and the server all agree', () => {
    const { hive } = resolveMultiplayerModes(SERVER_BUILD)

    expect(hive.available).toBe(true)
    expect(hive.blocker).toBe(null)
    expect(hive.explanation).toBe(null)
  })

  // Ordered from the most fundamental reason to the most specific, so the message a player reads
  // is the first thing that actually has to change.
  it.each([
    [
      'the static Pages export has no server routes at all',
      PAGES_BUILD,
      'static-export',
      /정적|Pages/,
    ],
    [
      'the build does not ship the HIVE login flow',
      { ...SERVER_BUILD, hiveLoginWired: false },
      'login-unwired',
      /로그인/,
    ],
    [
      'the server has not answered the capability probe yet',
      { ...SERVER_BUILD, serverCapability: null },
      'capability-unknown',
      /확인/,
    ],
    [
      'the server is missing HIVE configuration',
      { ...SERVER_BUILD, serverCapability: { configured: false, blockers: ['HIVE_APP_ID'] } },
      'server-unconfigured',
      /설정/,
    ],
  ])('is unavailable when %s', (_label, input, blocker, explanation) => {
    const { hive } = resolveMultiplayerModes(input)

    expect(hive.available).toBe(false)
    expect(hive.blocker).toBe(blocker)
    expect(hive.explanation).toMatch(explanation)
  })

  it('never names a missing environment variable to the player', () => {
    const { hive } = resolveMultiplayerModes({
      ...SERVER_BUILD,
      serverCapability: { configured: false, blockers: ['ROOM_TOKEN_SECRET'] },
    })

    expect(hive.explanation).not.toContain('ROOM_TOKEN_SECRET')
  })

  it('reports a static build as unavailable even if a stale probe said otherwise', () => {
    const { hive } = resolveMultiplayerModes({
      ...PAGES_BUILD,
      hiveLoginWired: true,
      serverCapability: { configured: true, blockers: [] },
    })

    expect(hive.available).toBe(false)
    expect(hive.blocker).toBe('static-export')
  })
})

describe('build flags', () => {
  it('treats anything but an explicit opt-in as off', () => {
    expect(readClientBuildFlags({ staticExport: 'true', hiveLogin: 'enabled' }))
      .toEqual({ staticExport: true, hiveLoginWired: true })
    expect(readClientBuildFlags({})).toEqual({ staticExport: false, hiveLoginWired: false })
    expect(readClientBuildFlags({ staticExport: 'false', hiveLogin: '1' }))
      .toEqual({ staticExport: false, hiveLoginWired: false })
  })

  // The default build ships no HIVE login, so the queue must be closed with a reason.
  it('keeps the HIVE queue closed on a default server build', () => {
    const { hive } = resolveMultiplayerModes({
      ...readClientBuildFlags({}),
      serverCapability: { configured: true, blockers: [] },
      roomEndpointConfigured: true,
    })

    expect(hive.available).toBe(false)
    expect(hive.blocker).toBe('login-unwired')
  })
})

describe('capability probing', () => {
  it('probes only when a probe could change the answer', () => {
    expect(shouldProbeHiveCapability({ ...SERVER_BUILD, serverCapability: null })).toBe(true)
    expect(shouldProbeHiveCapability(PAGES_BUILD)).toBe(false)
    expect(shouldProbeHiveCapability({ ...SERVER_BUILD, hiveLoginWired: false })).toBe(false)
    expect(shouldProbeHiveCapability(SERVER_BUILD)).toBe(false)
  })

  it('builds the capability url under the deployment base path', () => {
    expect(hiveCapabilityEndpoint('')).toBe('/api/hive/session')
    expect(hiveCapabilityEndpoint('/hellbreak')).toBe('/hellbreak/api/hive/session')
  })

  it.each([
    ['a ready server', { configured: true, blockers: [] }, { configured: true, blockers: [] }],
    ['a blocked server', { configured: false, blockers: ['HIVE_APP_ID'] }, { configured: false, blockers: ['HIVE_APP_ID'] }],
    ['a non-object answer', 'nope', { configured: false, blockers: [] }],
    ['a lying answer', { configured: 'yes' }, { configured: false, blockers: [] }],
    ['non-string blockers', { configured: false, blockers: [1, 2] }, { configured: false, blockers: [] }],
    ['a null answer', null, { configured: false, blockers: [] }],
  ])('parses %s defensively', (_label, payload, expected) => {
    expect(parseHiveCapability(payload)).toEqual(expected)
  })
})
