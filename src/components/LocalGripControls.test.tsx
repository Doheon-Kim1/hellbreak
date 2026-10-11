import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MobileControls } from './HellbreakGame'
import { ControlGuide } from './ControlGuide'
import { createRunnerControlSources } from '../game/controls'
import { DEFAULT_GAME_SETTINGS } from '../game/settings'
it('offers a local touch ledge hold without claiming teammate rescue is available', () => {
  const props = { controls: { input: { current: createRunnerControlSources() }, jumpQueued: { current: false },
    abilityQueued: { current: false }, blocked: { current: false }, settings: { current: { ...DEFAULT_GAME_SETTINGS } }, audio: { current: null } },
    heldAbility: null, rescueEnabled: false, localGripEnabled: true }
  const html = renderToStaticMarkup(<MobileControls {...props} />)
  expect(html).toContain('aria-label="턱 잡기"')
  expect(html).not.toContain('aria-label="구조 잡기"')
  expect(html).toContain('aria-label="능력 사용"')
})
it('explains offline hang jump and airborne route ledges, not unlimited wall climbing', () => {
  const html = renderToStaticMarkup(<ControlGuide online={false} />)
  expect(html).toContain('매달림 점프')
  expect(html).toContain('공중에서 발판 턱 잡기')
  expect(html).toContain('능력 사용')
  expect(html).not.toContain('팀원 구조')
})
