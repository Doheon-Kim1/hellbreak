'use client'

import { useEffect, useRef } from 'react'
import { DEFAULT_GAME_SETTINGS } from '../game/settings'
import type { GameSettings } from '../game/settings'

export function SettingsDialog({ open, settings, online, saved, onChange, onClose, onTestSound }: {
  open: boolean; settings: GameSettings; online: boolean; saved: boolean
  onChange: (settings: GameSettings) => void; onClose: () => void; onTestSound?: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (open) dialog.current?.showModal()
    else dialog.current?.close()
  }, [open])
  const slider = (key: 'sensitivity' | 'masterVolume' | 'effectsVolume' | 'ambientVolume', label: string) => (
    <label className="settings-slider">
      <span>{label}<output>{key === 'sensitivity' ? `${settings[key].toFixed(2)}×` : `${Math.round(settings[key] * 100)}%`}</output></span>
      <input type="range" aria-label={label} min={key === 'sensitivity' ? 0.2 : 0}
        max={key === 'sensitivity' ? 3 : 1} step={key === 'sensitivity' ? 0.05 : 0.01}
        value={settings[key]} onChange={(event) => onChange({ ...settings, [key]: Number(event.target.value) })} />
    </label>
  )
  return (
    <dialog ref={dialog} className="settings-dialog" aria-labelledby="settings-title"
      onCancel={(event) => { event.preventDefault(); onClose() }}>
      <header><div><small>HELLBREAK · PREFERENCES</small><h2 id="settings-title">게임 설정</h2></div>
        <button type="button" aria-label="설정 닫기" onClick={onClose}>닫기 · Esc</button></header>
      <p className="settings-note">{online ? '온라인 경기는 계속 진행됩니다. 설정을 여는 동안 이동과 잡기는 해제됩니다.' : '봇 경기는 설정을 여는 동안 일시정지됩니다.'}</p>
      <fieldset><legend>시점 조작</legend>
        {slider('sensitivity', '마우스 민감도')}
        <label className="settings-check"><input type="checkbox" checked={settings.invertY}
          onChange={(event) => onChange({ ...settings, invertY: event.target.checked })} />Y축 반전</label>
      </fieldset>
      <fieldset><legend>게임 사운드</legend>
        {slider('masterVolume', '전체 볼륨')}{slider('effectsVolume', '효과음 볼륨')}{slider('ambientVolume', '용암 배경음 볼륨')}
        <label className="settings-check"><input type="checkbox" checked={settings.muted}
          onChange={(event) => onChange({ ...settings, muted: event.target.checked })} />전체 음소거</label>
        {onTestSound && <button type="button" onClick={onTestSound}>효과음 미리 듣기</button>}
      </fieldset>
      <p className="settings-note">Space: 점프 · 온라인 매달림 중 Space: 손을 놓고 점프 · W: 턱 올라가기</p>
      <footer><button type="button" onClick={() => onChange({ ...DEFAULT_GAME_SETTINGS })}>기본값 복원</button>
        <span role="status">{saved ? '이 기기에 자동 저장됩니다' : '이 브라우저에서는 저장할 수 없습니다'}</span></footer>
    </dialog>
  )
}
