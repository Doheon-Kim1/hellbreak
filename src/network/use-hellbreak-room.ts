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
} from '../shared/multiplayer-protocol'

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
  const [roomId, setRoomId] = useState('')
  const [ownPlayerId, setOwnPlayerId] = useState('')
  const [players, setPlayers] = useState<NetworkPlayerSnapshot[]>([])
  const [match, setMatch] = useState<NetworkMatchSnapshot>(IDLE_MATCH)
  const [error, setError] = useState<string | null>(null)
  const roomRef = useRef<ClientRoom | null>(null)
  const sequenceRef = useRef(0)
  const connectionAttemptRef = useRef(0)
  const connectingRef = useRef(false)

  useEffect(() => {
    const resolved = configuredEndpoint()
    setEndpoint(resolved)
    setStatus(resolved ? 'idle' : 'unavailable')
  }, [])

  const clearRoom = useCallback(() => {
    roomRef.current?.removeAllListeners()
    roomRef.current = null
    sequenceRef.current = 0
    setRoomId('')
    setOwnPlayerId('')
    setPlayers([])
    setMatch(IDLE_MATCH)
  }, [])

  const leave = useCallback(async () => {
    connectionAttemptRef.current += 1
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
    setStatus(endpoint ? 'idle' : 'unavailable')
  }, [clearRoom, endpoint])

  useEffect(() => () => {
    connectionAttemptRef.current += 1
    const room = roomRef.current
    roomRef.current = null
    room?.removeAllListeners()
    void room?.leave(true)
  }, [])

  const connect = useCallback(async (kind: 'create' | 'join', requestedRoomId = '') => {
    if (!endpoint || connectingRef.current) return
    const normalizedRoomId = requestedRoomId.trim().slice(0, 64)
    if (kind === 'join' && !normalizedRoomId) {
      setError('참가할 룸 ID를 입력하세요.')
      setStatus('error')
      return
    }

    connectingRef.current = true
    const attempt = connectionAttemptRef.current + 1
    connectionAttemptRef.current = attempt
    const previousRoom = roomRef.current
    clearRoom()
    if (previousRoom) {
      try {
        await previousRoom.leave(true)
      } catch {
        // The previous connection is already closed.
      }
    }
    if (connectionAttemptRef.current !== attempt) {
      connectingRef.current = false
      return
    }
    setStatus('connecting')
    setError(null)
    try {
      const client = new Client(endpoint)
      const room = kind === 'create'
        ? await client.create<HellbreakRoomState>(HELLBREAK_ROOM_NAME)
        : await client.joinById<HellbreakRoomState>(normalizedRoomId)
      if (connectionAttemptRef.current !== attempt) {
        room.removeAllListeners()
        await room.leave(true)
        return
      }
      roomRef.current = room
      setRoomId(room.roomId)
      setOwnPlayerId(room.sessionId)
      const sync = (state: HellbreakRoomState) => {
        setPlayers(snapshotPlayers(state))
        setMatch(snapshotMatch(state))
      }
      room.onStateChange(sync)
      sync(room.state)
      room.onLeave(() => {
        if (roomRef.current !== room) return
        clearRoom()
        setStatus(endpoint ? 'idle' : 'unavailable')
      })
      room.onError(() => {
        if (roomRef.current !== room) return
        setError('룸 서버 연결 중 오류가 발생했습니다.')
        setStatus('error')
      })
      setStatus('connected')
    } catch (connectionError) {
      if (connectionAttemptRef.current !== attempt) return
      clearRoom()
      const fallback = kind === 'create' ? '룸을 만들지 못했습니다.' : '해당 룸에 참가하지 못했습니다.'
      setError(connectionError instanceof Error ? connectionError.message : fallback)
      setStatus('error')
    } finally {
      connectingRef.current = false
    }
  }, [clearRoom, endpoint])

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
    roomId,
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
