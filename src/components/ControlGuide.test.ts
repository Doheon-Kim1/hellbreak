import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { ControlGuide } from './ControlGuide'

it('labels only supported controls for each game mode', () => {
  const online = renderToStaticMarkup(createElement(ControlGuide, { online: true }))
  expect(online).toContain('잡기')
  expect(online).toContain('턱 올라가기')
  expect(online).not.toContain('능력')
  const local = renderToStaticMarkup(createElement(ControlGuide, { online: false }))
  expect(local).toContain('능력 사용')
  expect(local).toContain('턱 올라가기')
  expect(local).toContain('매달림 점프')
  expect(local).toContain('공중에서 발판 턱 잡기')
  expect(local).not.toContain('팀원 구조')
})
