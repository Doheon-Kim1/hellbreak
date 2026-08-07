'use client'

import { useState } from 'react'
import type { RoomConnectionStatus } from '../network/use-hellbreak-room'

export function MultiplayerLobby({
  status,
  roomId,
  playerCount,
  error,
  onCreate,
  onJoin,
  onLeave,
}: {
  status: RoomConnectionStatus
  roomId: string
  playerCount: number
  error: string | null
  onCreate: () => void
  onJoin: (roomId: string) => void
  onLeave: () => void
}) {
  const [joinId, setJoinId] = useState('')
  const connected = status === 'connected'

  return (
    <div className="multiplayer-lobby" aria-label="온라인 룸">
      {status === 'unavailable' ? (
        <p className="room-message">온라인 룸 서버 주소가 설정되지 않았습니다.</p>
      ) : connected ? (
        <>
          <div className="room-summary">
            <span>ROOM</span>
            <strong data-testid="room-id">{roomId}</strong>
            <small data-testid="player-count">참가자 {playerCount}/6</small>
          </div>
          <button type="button" className="secondary-action" onClick={() => void onLeave()}>
            룸 나가기
          </button>
        </>
      ) : (
        <>
          <button type="button" onClick={onCreate} disabled={status === 'connecting'}>
            {status === 'connecting' ? '연결 중…' : '온라인 룸 만들기'}
          </button>
          <div className="join-room-row">
            <label htmlFor="room-id-input">룸 ID</label>
            <input
              id="room-id-input"
              value={joinId}
              maxLength={64}
              autoComplete="off"
              onChange={(event) => setJoinId(event.target.value)}
              placeholder="공유받은 룸 ID"
            />
            <button type="button" onClick={() => onJoin(joinId)} disabled={status === 'connecting'}>
              참가
            </button>
          </div>
        </>
      )}
      {error && <p className="room-error" role="alert">{error}</p>}
    </div>
  )
}
