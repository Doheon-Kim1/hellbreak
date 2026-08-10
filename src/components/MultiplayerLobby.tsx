'use client'

import { useState } from 'react'
import { roomPhaseLabel } from '../network/room-connection'
import type { RoomConnectionPhase } from '../network/room-connection'
import type { RoomConnectionStatus } from '../network/use-hellbreak-room'
import type { MultiplayerModeId, MultiplayerModeView } from '../shared/multiplayer-modes'
import type { RoomJoinMode } from '../shared/multiplayer-protocol'

/**
 * The two online branches, kept explicitly apart.
 *
 * The guest branch is the deployed demo and always renders the same controls it always has. The
 * HIVE branch is only ever selectable when the build, the browser login flow, and the server all
 * say it exists; otherwise its button is disabled and the reason is written out next to it. There
 * is deliberately no state in which the lobby offers authenticated matchmaking and then fails.
 */
export function MultiplayerLobby({
  status,
  connectionPhase,
  roomId,
  roomMode,
  playerCount,
  error,
  finished,
  modes,
  selectedMode,
  onSelectMode,
  onCreate,
  onJoin,
  onLeave,
  onRestart,
}: {
  status: RoomConnectionStatus
  connectionPhase: RoomConnectionPhase
  roomId: string
  roomMode: RoomJoinMode
  playerCount: number
  error: string | null
  finished: boolean
  modes: { guest: MultiplayerModeView; hive: MultiplayerModeView }
  selectedMode: MultiplayerModeId
  onSelectMode: (mode: MultiplayerModeId) => void
  onCreate: () => void
  onJoin: (roomId: string) => void
  onLeave: () => void
  onRestart: () => void
}) {
  const [joinId, setJoinId] = useState('')
  const connected = status === 'connected'
  const connecting = status === 'connecting'
  // The free room server suspends when idle, so a connection attempt can honestly take a minute
  // and a half. The wait is named while it happens rather than left to look like a hang.
  const progress = connecting ? roomPhaseLabel(connectionPhase) : null
  const { guest, hive } = modes

  return (
    <div className="multiplayer-lobby" aria-label="온라인 룸">
      {!connected && (
        <>
          <div className="multiplayer-branches" role="group" aria-label="멀티플레이 방식">
            {[guest, hive].map((mode) => (
              <button
                key={mode.id}
                type="button"
                className={selectedMode === mode.id ? 'branch selected' : 'branch'}
                data-testid={`multiplayer-mode-${mode.id}`}
                data-available={String(mode.available)}
                data-blocker={mode.blocker ?? ''}
                aria-pressed={selectedMode === mode.id}
                disabled={!mode.available}
                onClick={() => onSelectMode(mode.id)}
              >
                <strong>{mode.label}</strong>
                <small>{mode.description}</small>
              </button>
            ))}
          </div>
          {!hive.available && (
            <p
              className="branch-explanation"
              data-testid="hive-unavailable"
              data-blocker={hive.blocker ?? ''}
            >
              {hive.explanation}
            </p>
          )}
        </>
      )}

      {selectedMode === 'hive' && !connected ? (
        // Reachable only once the queue client ships; until then the branch above is disabled.
        <p className="room-message" data-testid="hive-queue-pending">
          HIVE 대기열 화면은 아직 이 빌드에 포함되지 않았습니다.
        </p>
      ) : status === 'unavailable' ? (
        <p className="room-message">{guest.explanation ?? '온라인 룸 서버 주소가 설정되지 않았습니다.'}</p>
      ) : connected ? (
        <>
          <div className="room-summary">
            <span>ROOM</span>
            <strong data-testid="room-id">{roomId}</strong>
            <small data-testid="player-count">참가자 {playerCount}/6</small>
            <small className={`room-mode ${roomMode}`} data-testid="room-mode" data-mode={roomMode}>
              {roomMode === 'authenticated' ? 'HIVE 인증 룸' : '게스트 데모 룸'}
            </small>
          </div>
          <div className="room-actions">
            {finished && (
              <button type="button" data-testid="room-restart" onClick={onRestart}>
                다시 경기
              </button>
            )}
            <button type="button" className="secondary-action" onClick={() => void onLeave()}>
              룸 나가기
            </button>
          </div>
        </>
      ) : (
        <>
          <button type="button" onClick={onCreate} disabled={connecting} aria-busy={connecting}>
            {connecting ? '연결 중…' : '온라인 룸 만들기'}
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
            <button type="button" onClick={() => onJoin(joinId)} disabled={connecting} aria-busy={connecting}>
              참가
            </button>
          </div>
          {progress && (
            <p
              className="room-progress"
              role="status"
              data-testid="room-progress"
              data-phase={connectionPhase}
            >
              {progress}
            </p>
          )}
        </>
      )}
      {error && <p className="room-error" role="alert">{error}</p>}
    </div>
  )
}
