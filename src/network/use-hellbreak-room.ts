'use client'

import { Client } from '@colyseus/sdk'
import type { Room } from '@colyseus/sdk'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { HellbreakRoomState } from '../server/hellbreak-state'
import { HELLBREAK_ROOM_NAME } from '../shared/multiplayer-protocol'
import type {
  MultiplayerInputCommand,
  NetworkMatchSnapshot,
  NetworkPlayerSnapshot,
  RoomJoinMode,
} from '../shared/multiplayer-protocol'
import { openRoomWhenAwake, roomConnectionMessage } from './room-connection'
import type { RoomConnectionPhase } from './room-connection'
import { wakeRoomServer } from './room-wakeup'

export type RoomConnectionStatus = 'unavailable' | 'idle' | 'connecting' | 'connected' | 'error'

type ClientRoom = Room<any, HellbreakRoomState>

function configuredEndpoint(): string | null {
  const explicit = process.env.NEXT_PUBLIC_GAME_SERVER_URL?.trim()
  if (explicit) return explicit
  if (typeof window === 'undefined') return null
  if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') return null
  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
  return `${protocol}//${window.location.hostname}:2567`
}

const IDLE_MATCH: NetworkMatchSnapshot = {
  elapsed: 0,
  durationSeconds: 180,
  lavaHeight: -4,
  lavaPhase: 'calm',
  phase: 'running',
  winner: '',
  eliminations: 0,
}

function snapshotPlayers(state: HellbreakRoomState | undefined): NetworkPlayerSnapshot[] {
  const players: NetworkPlayerSnapshot[] = []
  if (!state?.players) return players
  state.players.forEach((player) => {
    players.push({
      id: player.id,
      x: player.x,
      y: player.y,
      z: player.z,
      velocityY: player.velocityY,
      grounded: player.grounded,
      alive: player.alive,
      escaped: player.escaped,
      lastProcessedInput: player.lastProcessedInput,
      lastAcknowledgedJump: player.lastAcknowledgedJump,
      // New Schema fields may be absent during the first incremental patch from an older or
      // not-yet-fully-decoded state. Normalize them before any HUD formatting or link logic runs.
      grabTargetId: player.grabTargetId ?? '',
      grabbedById: player.grabbedById ?? '',
      structureGripAnchorId: player.structureGripAnchorId ?? '',
      grip: Number.isFinite(player.grip) ? player.grip : 1,
      lastAcknowledgedGrab: player.lastAcknowledgedGrab ?? 0,
    })
  })
  return players.sort((left, right) => left.id.localeCompare(right.id))
}

function snapshotMatch(state: HellbreakRoomState | undefined): NetworkMatchSnapshot {
  if (!state) return IDLE_MATCH
  return {
    elapsed: state.elapsed,
    durationSeconds: state.durationSeconds || IDLE_MATCH.durationSeconds,
    lavaHeight: state.lavaHeight,
    lavaPhase: state.lavaPhase,
    phase: state.matchPhase,
    winner: state.winner,
    eliminations: state.eliminations,
  }
}

export function useHellbreakRoom() {
  const [endpoint, setEndpoint] = useState<string | null>(null)
  const [status, setStatus] = useState<RoomConnectionStatus>('unavailable')
  const [connectionPhase, setConnectionPhase] = useState<RoomConnectionPhase>('idle')
  const [roomId, setRoomId] = useState('')
  const [ownPlayerId, setOwnPlayerId] = useState('')
  const [players, setPlayers] = useState<NetworkPlayerSnapshot[]>([])
  const [match, setMatch] = useState<NetworkMatchSnapshot>(IDLE_MATCH)
  const [roomMode, setRoomMode] = useState<RoomJoinMode>('guest')
  const [error, setError] = useState<string | null>(null)
  const roomRef = useRef<ClientRoom | null>(null)
  const sequenceRef = useRef(0)
  const connectionAttemptRef = useRef(0)
  const connectingRef = useRef(false)
  /** Aborts the health probe of whichever attempt is currently in flight, if any. */
  const wakeRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const resolved = configuredEndpoint()
    setEndpoint(resolved)
    setStatus(resolved ? 'idle' : 'unavailable')
  }, [])

  /**
   * Invalidates the attempt in flight: bumps the generation every callback checks, and aborts the
   * outstanding probe so a wake that had 80 seconds left stops now instead of resolving into state
   * for a screen that has moved on.
   */
  const abandonAttempt = useCallback(() => {
    connectionAttemptRef.current += 1
    wakeRef.current?.abort()
    wakeRef.current = null
  }, [])

  const clearRoom = useCallback(() => {
    roomRef.current?.removeAllListeners()
    roomRef.current = null
    sequenceRef.current = 0
    setRoomId('')
    setOwnPlayerId('')
    setPlayers([])
    setMatch(IDLE_MATCH)
    setRoomMode('guest')
  }, [])

  const leave = useCallback(async () => {
    abandonAttempt()
    const room = roomRef.current
    clearRoom()
    if (room) {
      try {
        await room.leave(true)
      } catch {
        // A closed server has already completed the effective leave.
      }
    }
    setError(null)
    setConnectionPhase('idle')
    setStatus(endpoint ? 'idle' : 'unavailable')
  }, [abandonAttempt, clearRoom, endpoint])

  useEffect(() => () => {
    abandonAttempt()
    const room = roomRef.current
    roomRef.current = null
    room?.removeAllListeners()
    void room?.leave(true)
  }, [abandonAttempt])

  const connect = useCallback(async (kind: 'create' | 'join', requestedRoomId = '') => {
    if (!endpoint || connectingRef.current) return
    const normalizedRoomId = requestedRoomId.trim().slice(0, 64)
    if (kind === 'join' && !normalizedRoomId) {
      setError('참가할 룸 ID를 입력하세요.')
      setStatus('error')
      return
    }

    connectingRef.current = true
    abandonAttempt()
    const attempt = connectionAttemptRef.current
    const wake = new AbortController()
    wakeRef.current = wake
    const current = () => connectionAttemptRef.current === attempt && !wake.signal.aborted

    const previousRoom = roomRef.current
    clearRoom()
    if (previousRoom) {
      try {
        await previousRoom.leave(true)
      } catch {
        // The previous connection is already closed.
      }
    }
    if (!current()) {
      connectingRef.current = false
      return
    }
    setStatus('connecting')
    setConnectionPhase('waking')
    setError(null)

    try {
      const result = await openRoomWhenAwake<ClientRoom>({
        // The free Render instance suspends when idle. Knocking on `/health` until it answers is
        // what keeps the SDK's one matchmaking request from being the thing that discovers it.
        wake: () => wakeRoomServer({ endpoint, mode: 'guest', signal: wake.signal }),
        open: () => {
          const client = new Client(endpoint)
          return kind === 'create'
            ? client.create<HellbreakRoomState>(HELLBREAK_ROOM_NAME)
            : client.joinById<HellbreakRoomState>(normalizedRoomId)
        },
        onPhase: (phase) => {
          if (current()) setConnectionPhase(phase)
        },
        superseded: () => !current(),
      })

      if (!current()) {
        // Left, unmounted, or superseded while the room was opening: hand the seat straight back.
        if (result.ok) {
          result.room.removeAllListeners()
          await result.room.leave(true).catch(() => undefined)
        }
        return
      }
      if (!result.ok) {
        // A cancelled attempt has already been answered by whoever cancelled it.
        if (result.failure === 'cancelled') return
        clearRoom()
        setError(roomConnectionMessage(result.failure, kind))
        setConnectionPhase('idle')
        setStatus('error')
        return
      }

      const { room } = result
      roomRef.current = room
      setRoomId(room.roomId)
      setOwnPlayerId(room.sessionId)
      const sync = (state: HellbreakRoomState) => {
        setPlayers(snapshotPlayers(state))
        setMatch(snapshotMatch(state))
        // The room decides its own join mode; the client only reads what it published.
        setRoomMode(state.joinMode === 'authenticated' ? 'authenticated' : 'guest')
      }
      room.onStateChange(sync)
      sync(room.state)
      room.onLeave(() => {
        if (roomRef.current !== room) return
        clearRoom()
        setConnectionPhase('idle')
        setStatus(endpoint ? 'idle' : 'unavailable')
      })
      room.onError(() => {
        if (roomRef.current !== room) return
        setError('룸 서버 연결 중 오류가 발생했습니다.')
        setStatus('error')
      })
      setConnectionPhase('idle')
      setStatus('connected')
    } catch {
      // `openRoomWhenAwake` already absorbs every network and SDK failure, so only wiring up the
      // room can land here. It still gets a written sentence rather than a rejected promise.
      if (!current()) return
      clearRoom()
      setError(roomConnectionMessage('join-refused', kind))
      setConnectionPhase('idle')
      setStatus('error')
    } finally {
      if (wakeRef.current === wake) wakeRef.current = null
      connectingRef.current = false
    }
  }, [abandonAttempt, clearRoom, endpoint])

  const createRoom = useCallback(() => connect('create'), [connect])
  const joinRoom = useCallback((requestedRoomId: string) => connect('join', requestedRoomId), [connect])
  const sendInput = useCallback((input: Omit<MultiplayerInputCommand, 'sequence'>) => {
    const room = roomRef.current
    if (!room || status !== 'connected') return
    sequenceRef.current += 1
    room.send('input', { ...input, sequence: sequenceRef.current } satisfies MultiplayerInputCommand)
  }, [status])
  const requestRestart = useCallback(() => {
    const room = roomRef.current
    if (!room || status !== 'connected') return
    room.send('restart')
  }, [status])

  return {
    endpoint,
    status,
    /** What a `connecting` status is actually doing, so the wait can be described honestly. */
    connectionPhase,
    roomId,
    roomMode,
    ownPlayerId,
    players,
    match,
    error,
    createRoom,
    joinRoom,
    leave,
    sendInput,
    requestRestart,
  }
}
