import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { Server } from '@colyseus/core'
import { WebSocketTransport } from '@colyseus/ws-transport'
import type { Request, Response } from 'express'
import { HELLBREAK_ROOM_NAME } from '../shared/multiplayer-protocol'
import { HellbreakRoom } from './hellbreak-room'

export interface HellbreakServerOptions {
  port?: number
  hostname?: string
}

export async function createHellbreakServer(options: HellbreakServerOptions = {}) {
  const port = options.port ?? 2567
  const hostname = options.hostname ?? '0.0.0.0'
  const httpServer = createServer()
  const gameServer = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
    greet: false,
    express: (app) => {
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
