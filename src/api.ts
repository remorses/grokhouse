// The page side of /api/*: typed fetch wrappers. Errors come back as values.

import * as errore from 'errore'
import type { Cursor, FeedSnapshot, Me, OfficeSnapshot, ReadState, WatchEvent } from '../worker/protocol.ts'

export class ApiError extends errore.createTaggedError({
  name: 'ApiError',
  message: '$reason',
}) {}

const TIMEOUT_MS = 30_000
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

async function request<T>({ path, method = 'GET', body }: { path: string; method?: string; body?: unknown }) {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'x-timezone': timeZone, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).catch((cause) => new ApiError({ reason: 'The office server did not answer. Check your connection.', cause }))
  if (response instanceof Error) return response
  const data = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) return new ApiError({ reason: data.error ?? `HTTP ${response.status}` })
  return data as T
}

export const api = {
  me: () => request<Me>({ path: '/api/me' }),
  login: () => request<{ url: string }>({ path: '/api/login', method: 'POST' }),
  pollLogin: () => request<{ done: boolean; email?: string | null }>({ path: '/api/login/poll' }),
  logout: () => request<{ ok: true }>({ path: '/api/logout', method: 'POST' }),
  office: () => request<OfficeSnapshot>({ path: '/api/office' }),
  feed: (id: string) => request<FeedSnapshot>({ path: `/api/bots/${id}/feed` }),
  send: ({ id, text, messageId }: { id: string; text: string; messageId: string }) => request<{ ok: true }>({ path: `/api/bots/${id}/message`, method: 'POST', body: { text, messageId } }),
  answer: ({ id, entryId, value }: { id: string; entryId: string; value: string }) => request<{ ok: true }>({ path: `/api/bots/${id}/answer`, method: 'POST', body: { entryId, value } }),
  interrupt: (id: string) => request<{ ok: true }>({ path: `/api/bots/${id}/interrupt`, method: 'POST' }),
  markRead: (id: string) => request<{ read: ReadState }>({ path: `/api/bots/${id}/read`, method: 'POST' }),
  watch,
}

// No byte for this long means the stream died quietly (the backend sends a heartbeat every 10 s).
const WATCH_IDLE_MS = 35_000

// Reads /api/watch until it ends. Resolves null when the server ended it cleanly (it does
// every ~20 minutes), or an error; the caller reconnects either way.
async function watch({ cursors, signal, onEvent }: { cursors: Array<Cursor & { botId: string }>; signal: AbortSignal; onEvent: (event: WatchEvent) => void }) {
  const own = new AbortController()
  let timer = setTimeout(() => own.abort(), WATCH_IDLE_MS)
  try {
    const response = await fetch('/api/watch', {
      method: 'POST',
      credentials: 'same-origin',
      signal: AbortSignal.any([signal, own.signal]),
      headers: { 'content-type': 'application/json', 'x-timezone': timeZone },
      body: JSON.stringify({ cursors }),
    }).catch((cause) => new ApiError({ reason: 'The live stream did not connect.', cause }))
    if (response instanceof Error) return response
    if (!response.ok || !response.body) {
      const data = (await response.json().catch(() => ({}))) as { error?: string }
      return new ApiError({ reason: data.error ?? `HTTP ${response.status}` })
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ''
    for (;;) {
      const chunk = await reader.read().catch((cause) => new ApiError({ reason: 'The live stream dropped.', cause }))
      if (chunk instanceof Error) return chunk
      if (chunk.done) return null
      clearTimeout(timer)
      timer = setTimeout(() => own.abort(), WATCH_IDLE_MS)
      buffer += chunk.value
      // Server-sent events: `data: {json}` blocks separated by a blank line.
      const blocks = buffer.split('\n\n')
      buffer = blocks.pop() ?? ''
      for (const block of blocks) {
        const event = errore.try(() => JSON.parse(block.replace(/^data: /, '')) as WatchEvent)
        if (event instanceof Error) continue
        if (event.type === 'end') return event.error ? new ApiError({ reason: event.error }) : null
        onEvent(event)
      }
    }
  } finally {
    // Every exit: stop the watchdog and drop the connection (and its reader) for good.
    clearTimeout(timer)
    own.abort()
  }
}
