'use client'

import { useEffect, useRef } from 'react'
import { createGameAudio } from './audio'
import type { GameAudio } from './audio'
import type { GameSettings } from './settings'

export function useGameAudio(settings: GameSettings, playing: boolean) {
  const audio = useRef<GameAudio | null>(null)
  const latest = useRef({ settings, playing })
  latest.current = { settings, playing }
  useEffect(() => { audio.current?.update(settings, playing) }, [settings, playing])
  useEffect(() => {
    const unlock = (event?: Event) => {
      if (document.visibilityState !== 'visible' || (event && !event.isTrusted)) return
      if (!audio.current) {
        try {
          if (typeof AudioContext === 'undefined') return
          audio.current = createGameAudio(new AudioContext())
          audio.current.update(latest.current.settings, latest.current.playing)
        } catch { return } // Unsupported/denied audio must never prevent gameplay.
      }
      audio.current.unlock()
    }
    const onGesture = (event: Event) => unlock(event)
    const pause = () => audio.current?.suspend()
    const visible = () => {
      if (document.visibilityState !== 'visible') pause()
      else if (audio.current && document.hasFocus()) audio.current.unlock()
    }
    const focus = () => { if (audio.current) visible() }
    document.addEventListener('pointerdown', onGesture, true)
    document.addEventListener('keydown', onGesture, true)
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('blur', pause)
    window.addEventListener('focus', focus)
    return () => {
      document.removeEventListener('pointerdown', onGesture, true)
      document.removeEventListener('keydown', onGesture, true)
      document.removeEventListener('visibilitychange', visible)
      window.removeEventListener('blur', pause)
      window.removeEventListener('focus', focus)
      audio.current?.dispose()
      audio.current = null
    }
  }, [])
  return audio
}
