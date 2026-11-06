// The office Worker. Static assets serve the page; this answers /api/* and keeps the
// Grok Bot (Cursor) tokens in an HttpOnly cookie, so the page never sees them.
//
//   page ──/api/login──▶ cursor.com sign-in URL (PKCE verifier in a short cookie)
//   page ──/api/login/poll──▶ api2.cursor.sh/auth/poll ──▶ session cookie
//   page ──/api/office | /api/bots/:id/*──▶ GrokBotService
//   page ──/api/watch──▶ WatchGrokBotTranscripts (Connect stream) ──▶ server-sent events

import * as errore from 'errore'
import { createGrokClient, GrokAuthError, jwtClaims, openStream, pollLogin, refreshLogin, startLogin, type Tokens } from './grok.ts'
import { answerCard, interrupt, markRead, readFeed, readOffice, readTodos, sendMessage, toWatchEvents } from './office.ts'
import type { CardReply, FeedSnapshot, Me, OfficeSnapshot, WatchEvent } from './protocol.ts'

const SESSION_COOKIE = 'gbo_session'
const LOGIN_COOKIE = 'gbo_login'
const SESSION_MAX_AGE_S = 60 * 60 * 24 * 60
const LOGIN_MAX_AGE_S = 15 * 60
// Refresh the access token this long before it expires.
const REFRESH_EARLY_MS = 2 * 60_000
const MAX_PROMPT_CHARS = 4_000
const MAX_WATCHED = 50
// Bigger transcript entries arrive without a body; the page then reloads that feed.
const INLINE_BODY_BYTES = 64 * 1024
const FEED_ITEMS = 30

function readCookie(request: Request, name: string) {
  const header = request.headers.get('cookie') ?? ''
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

function cookie({ name, value, maxAge, request }: { name: string; value: string; maxAge: number; request: Request }) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
}

function json(body: unknown, init: { status?: number; cookies?: string[] } = {}) {
  const headers = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' })
  for (const value of init.cookies ?? []) headers.append('set-cookie', value)
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers })
}

function fail(error: Error, cookies: string[] = []) {
  const status = error instanceof GrokAuthError ? 401 : 502
  return json({ error: error.message }, { status, cookies })
}

function parseJson<T>(text: string | null) {
  if (!text) return null
  const value = errore.try(() => JSON.parse(text) as T)
  return value instanceof Error ? null : value
}

// The signed-in account, with its access token refreshed when it is about to expire.
async function session(request: Request) {
  const saved = parseJson<Tokens>(readCookie(request, SESSION_COOKIE))
  if (!saved?.accessToken || !saved.refreshToken) return null
  const exp = jwtClaims(saved.accessToken).exp
  if (exp && exp * 1000 - Date.now() > REFRESH_EARLY_MS) return { tokens: saved, cookies: [] as string[] }
  const fresh = await refreshLogin({ refreshToken: saved.refreshToken })
  if (fresh instanceof Error) return fresh
  return { tokens: fresh, cookies: [cookie({ name: SESSION_COOKIE, value: JSON.stringify(fresh), maxAge: SESSION_MAX_AGE_S, request })] }
}

const signedOut = (request: Request) => cookie({ name: SESSION_COOKIE, value: '', maxAge: 0, request })

async function handle(request: Request) {
  const url = new URL(request.url)
  const path = url.pathname
  const method = request.method

  if (path === '/api/login' && method === 'POST') {
    const login = await startLogin()
    const value = JSON.stringify({ uuid: login.uuid, verifier: login.verifier })
    return json({ url: login.url }, { cookies: [cookie({ name: LOGIN_COOKIE, value, maxAge: LOGIN_MAX_AGE_S, request })] })
  }

  if (path === '/api/login/poll' && method === 'GET') {
    const pending = parseJson<{ uuid: string; verifier: string }>(readCookie(request, LOGIN_COOKIE))
    if (!pending) return json({ error: 'No sign-in in progress. Press "Sign in with Grok Bot" again.' }, { status: 400 })
    const tokens = await pollLogin(pending)
    if (tokens instanceof Error) return fail(tokens)
    if (!tokens) return json({ done: false })
    return json(
      { done: true, email: jwtClaims(tokens.accessToken).email ?? null },
      {
        cookies: [
          cookie({ name: SESSION_COOKIE, value: JSON.stringify(tokens), maxAge: SESSION_MAX_AGE_S, request }),
          cookie({ name: LOGIN_COOKIE, value: '', maxAge: 0, request }),
        ],
      },
    )
  }

  if (path === '/api/logout' && method === 'POST') return json({ ok: true }, { cookies: [signedOut(request)] })

  const auth = await session(request)
  // Only a rejected login clears the cookie; a refresh that failed for a moment keeps it.
  if (auth instanceof GrokAuthError) return path === '/api/me' ? json({ signedIn: false, email: null } satisfies Me, { cookies: [signedOut(request)] }) : fail(auth, [signedOut(request)])
  if (auth instanceof Error) return json({ error: auth.message }, { status: 503 })
  if (path === '/api/me') return json({ signedIn: Boolean(auth), email: auth ? (jwtClaims(auth.tokens.accessToken).email ?? null) : null } satisfies Me, { cookies: auth?.cookies ?? [] })
  if (!auth) return json({ error: 'Not signed in. Press "Sign in with Grok Bot" on the office page.' }, { status: 401 })

  const timeZone = request.headers.get('x-timezone') || 'UTC'
  const call = createGrokClient({ accessToken: auth.tokens.accessToken, timeZone })
  const cookies = auth.cookies

  if (path === '/api/office' && method === 'GET') {
    const bots = await readOffice({ call, timeZone })
    if (bots instanceof Error) return fail(bots, cookies)
    return json({ email: jwtClaims(auth.tokens.accessToken).email ?? null, at: Date.now(), bots } satisfies OfficeSnapshot, { cookies })
  }

  // The account's live stream (transcripts, live state, read state, roster), as
  // server-sent events. The page reconnects when it ends (the backend caps it at ~20 min).
  if (path === '/api/watch' && method === 'POST') {
    const body = (await request.json().catch(() => null)) as { cursors?: Array<{ botId?: string; generation?: number; seq?: number }> } | null
    const cursors = (body?.cursors ?? []).slice(0, MAX_WATCHED).flatMap((c) =>
      typeof c.botId === 'string' && /^[0-9a-f-]{36}$/.test(c.botId) ? [{ agentId: c.botId, generation: Number(c.generation) || 0, afterUpdatedSeq: String(Number(c.seq) || 0), sessionId: '' }] : [],
    )
    // Aborted when the page goes away (request.signal) or the response is cancelled: a
    // pending read never ends on its own, so cancel must abort before closing the generator.
    const stop = new AbortController()
    const signal = AbortSignal.any([request.signal, stop.signal])
    const upstream = await openStream({ accessToken: auth.tokens.accessToken, timeZone, method: 'WatchGrokBotTranscripts', body: { cursors, inlineBodyMaxBytes: INLINE_BODY_BYTES }, signal })
    if (upstream instanceof Error) return fail(upstream, cookies)
    const events = (async function* (): AsyncGenerator<WatchEvent> {
      for await (const { last, message } of upstream) {
        if (last) {
          const error = (message as { error?: { message?: string } }).error
          yield { type: 'end', error: error ? (error.message ?? 'stream failed') : null }
          return
        }
        yield* toWatchEvents(message as Parameters<typeof toWatchEvents>[0])
      }
    })()
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const next = await events.next().catch(() => ({ done: true as const, value: undefined }))
        if (next.done) return controller.close()
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(next.value)}\n\n`))
      },
      async cancel() {
        stop.abort()
        await events.return(undefined)
      },
    })
    const headers = new Headers({ 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-accel-buffering': 'no' })
    for (const value of cookies) headers.append('set-cookie', value)
    return new Response(stream, { headers })
  }

  const route = /^\/api\/bots\/([0-9a-f-]{36})\/(feed|message|interrupt|answer|read)$/.exec(path)
  if (!route) return json({ error: `No route ${method} ${path}` }, { status: 404 })
  const [, agentId, action] = route

  if (action === 'feed' && method === 'GET') {
    const [feed, todos] = await Promise.all([readFeed({ call, agentId }), readTodos({ call, agentId })])
    if (feed instanceof Error) return fail(feed, cookies)
    return json({ at: Date.now(), feed: feed.items.slice(-FEED_ITEMS), todos: todos instanceof Error ? [] : todos, cursor: feed.cursor } satisfies FeedSnapshot, { cookies })
  }
  if (method !== 'POST') return json({ error: `Use POST for ${path}` }, { status: 405 })

  if (action === 'read') {
    const read = await markRead({ call, agentId })
    return read instanceof Error ? fail(read, cookies) : json({ read }, { cookies })
  }

  if (action === 'interrupt') {
    const result = await interrupt({ call, agentId })
    return result instanceof Error ? fail(result, cookies) : json({ ok: true }, { cookies })
  }

  const body = (await request.json().catch(() => null)) as { text?: string; messageId?: string; entryId?: string; value?: string } | null
  if (action === 'answer') {
    if (!body?.entryId || !body.value) return json({ error: 'Send { entryId, value }' }, { status: 400 })
    const result = await answerCard({ call, agentId, reply: { entryId: body.entryId, value: body.value } satisfies CardReply })
    return result instanceof Error ? fail(result, cookies) : json({ ok: true }, { cookies })
  }

  const text = body?.text?.trim() ?? ''
  if (!text) return json({ error: 'Write something to send.' }, { status: 400 })
  if (text.length > MAX_PROMPT_CHARS) return json({ error: `Keep it under ${MAX_PROMPT_CHARS} characters.` }, { status: 400 })
  const sent = await sendMessage({ call, agentId, text, messageId: body?.messageId || crypto.randomUUID() })
  return sent instanceof Error ? fail(sent, cookies) : json({ ok: true }, { cookies })
}

export default {
  async fetch(request: Request) {
    const response = await handle(request).catch((cause) => {
      console.error('office api failed', cause)
      return json({ error: 'The office server hit an unexpected error.' }, { status: 500 })
    })
    return response
  },
} satisfies ExportedHandler<Env>
