import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { Server } from '@colyseus/core'
import { WebSocketTransport } from '@colyseus/ws-transport'
import type { NextFunction, Request, Response } from 'express'
import { HELLBREAK_ROOM_NAME } from '../shared/multiplayer-protocol'
import { HellbreakRoom } from './hellbreak-room'

export interface HellbreakServerOptions {
  port?: number
  hostname?: string
  allowedOrigins?: string[]
}

const LOCAL_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173']

export async function createHellbreakServer(options: HellbreakServerOptions = {}) {
  const port = options.port ?? 2567
  const hostname = options.hostname ?? '0.0.0.0'
  const configuredOrigins = process.env.HELLBREAK_ALLOWED_ORIGINS
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  const allowedOrigins = new Set(options.allowedOrigins ?? configuredOrigins ?? LOCAL_ORIGINS)
  const originAllowed = (origin: string | undefined) => !origin || allowedOrigins.has(origin)
  const httpServer = createServer()
  const gameServer = new Server({
    transport: new WebSocketTransport({
      server: httpServer,
      verifyClient: (info, done) => {
        const allowed = originAllowed(info.origin)
        done(allowed, allowed ? undefined : 403, allowed ? undefined : 'Origin not allowed')
      },
    }),
    express: (app) => {
      app.use((request: Request, response: Response, next: NextFunction) => {
        const origin = request.get('origin')
        if (!originAllowed(origin)) {
          response.status(403).json({ error: 'Origin not allowed' })
          return
        }
        if (origin) {
          response.setHeader('Access-Control-Allow-Origin', origin)
          response.setHeader('Vary', 'Origin')
        }
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        if (request.method === 'OPTIONS') {
          response.sendStatus(204)
          return
        }
        next()
      })
      app.get('/health', (_request: Request, response: Response) => {
        response.json({ ok: true, room: HELLBREAK_ROOM_NAME })
      })
    },
  })
  gameServer.define(HELLBREAK_ROOM_NAME, HellbreakRoom)
  await gameServer.listen(port, hostname)

  let closed = false
  return {
    gameServer,
    httpServer,
    shutdown: async () => {
      if (closed) return
      closed = true
      await gameServer.gracefullyShutdown(false)
    },
  }
}

const entrypoint = process.argv[1]
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  const port = Number.parseInt(process.env.PORT ?? '2567', 10)
  const running = await createHellbreakServer({ port })
  const address = running.httpServer.address()
  const boundPort = typeof address === 'object' && address ? address.port : port
  console.log(`HELLBREAK room server listening on ws://0.0.0.0:${boundPort}`)
}
