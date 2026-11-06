// Grok Bot client for a Worker: Cursor's browser sign-in and Connect JSON calls to the
// private GrokBotService of api2.cursor.sh. Ported from kimakivoice
// opencode-grok-bot/src/grok-bot.ts (Node) to WebCrypto and fetch.
//
//   cursor.com/loginDeepControl?challenge&uuid ──▶ user approves ──▶ api2.cursor.sh/auth/poll ──▶ tokens
//   POST api2.cursor.sh/aiserver.v1.GrokBotService/<Method>   { json body }   Bearer access token
//
// Grok Bot has no public API; the protocol comes from the desktop app (proto.cjs). Enums
// use their full proto names in JSON and unknown fields make the backend reject a request.

import * as errore from 'errore'

const BACKEND_URL = 'https://api2.cursor.sh'
const WEBSITE_URL = 'https://cursor.com'
// Cursor's public OAuth client for its own CLIs and the Grok Bot app.
const CLIENT_ID = 'KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB'
const SERVICE_PATH = '/aiserver.v1.GrokBotService'
// The backend refuses client versions it considers outdated.
const CLIENT_VERSION = '0.78.5'
const REQUEST_TIMEOUT_MS = 20_000

export class GrokAuthError extends errore.createTaggedError({
  name: 'GrokAuthError',
  message: 'Grok Bot login failed: $reason. Sign in again from the office page.',
}) {}

export class GrokRequestError extends errore.createTaggedError({
  name: 'GrokRequestError',
  message: 'Grok Bot $method failed: $reason',
}) {}

export type Tokens = { accessToken: string; refreshToken: string }

function base64url(bytes: Uint8Array) {
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export function decodeBase64Utf8(value: string) {
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'))
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export function jwtClaims(token: string) {
  const claims = errore.try(() => JSON.parse(decodeBase64Utf8(token.split('.')[1] ?? '')) as { sub?: string; email?: string; exp?: number })
  return claims instanceof Error ? {} : claims
}

// Starts Cursor's browser sign-in: open `url`, then call pollLogin until it returns tokens.
export async function startLogin() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
  const uuid = crypto.randomUUID()
  const params = new URLSearchParams({ challenge, uuid, mode: 'login', redirectTarget: 'cli' })
  return { url: `${WEBSITE_URL}/loginDeepControl?${params}`, uuid, verifier }
}

// One poll. Cursor answers 404 until the user approves in the browser; that is `null` here.
export async function pollLogin({ uuid, verifier }: { uuid: string; verifier: string }) {
  const response = await fetch(`${BACKEND_URL}/auth/poll?${new URLSearchParams({ uuid, verifier })}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch((cause) => new GrokAuthError({ reason: 'login poll failed', cause }))
  if (response instanceof Error) return response
  if (!response.ok) return null
  const body = (await response.json().catch(() => null)) as { accessToken?: string; refreshToken?: string } | null
  if (!body?.accessToken || !body.refreshToken) return null
  return { accessToken: body.accessToken, refreshToken: body.refreshToken } satisfies Tokens
}

export async function refreshLogin({ refreshToken }: { refreshToken: string }) {
  const response = await fetch(`${BACKEND_URL}/oauth/token`, {
    method: 'POST',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: refreshToken }),
  }).catch((cause) => new GrokRequestError({ method: 'oauth/token', reason: 'token refresh failed', cause }))
  if (response instanceof Error) return response
  // Outages are temporary (the login stays); a rejected refresh token ends the login.
  if (response.status >= 500 || response.status === 429) return new GrokRequestError({ method: 'oauth/token', reason: `HTTP ${response.status}` })
  const body = (await response.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; shouldLogout?: boolean }
  if (!response.ok || body.shouldLogout || !body.access_token) return new GrokAuthError({ reason: `token refresh returned HTTP ${response.status}` })
  return { accessToken: body.access_token, refreshToken: body.refresh_token ?? refreshToken } satisfies Tokens
}

// Connect errors answer `{ code, message }`.
function errorReason({ status, text }: { status: number; text: string }) {
  const body = errore.try(() => JSON.parse(text) as { code?: string; message?: string })
  const detail = body instanceof Error ? text.slice(0, 200) : [body.code, body.message].filter(Boolean).join(': ')
  return `HTTP ${status} ${detail}`.trim()
}

export type GrokCall = <T>(input: { method: string; body: object }) => Promise<T | GrokAuthError | GrokRequestError>

function headers({ accessToken, timeZone, contentType }: { accessToken: string; timeZone: string; contentType: string }) {
  return {
    'content-type': contentType,
    'connect-protocol-version': '1',
    authorization: `Bearer ${accessToken}`,
    'x-cursor-client-type': 'sand',
    'x-cursor-client-version': CLIENT_VERSION,
    'x-sand-box-namespace': 'prod',
    'x-cursor-timezone': timeZone,
  }
}

export function createGrokClient({ accessToken, timeZone }: { accessToken: string; timeZone: string }): GrokCall {
  return async <T>({ method, body }: { method: string; body: object }) => {
    const response = await fetch(`${BACKEND_URL}${SERVICE_PATH}/${method}`, {
      method: 'POST',
      // Workers support only 'follow' and 'manual'; a redirect here would be a non-2xx answer.
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: headers({ accessToken, timeZone, contentType: 'application/json' }),
      body: JSON.stringify(body),
    }).catch((cause) => new GrokRequestError({ method, reason: 'request failed', cause }))
    if (response instanceof Error) return response
    const text = await response.text().catch(() => '')
    if (response.status === 401) return new GrokAuthError({ reason: 'the login expired' })
    if (!response.ok) return new GrokRequestError({ method, reason: errorReason({ status: response.status, text }) })
    const parsed = errore.try(() => JSON.parse(text) as T)
    if (parsed instanceof Error) return new GrokRequestError({ method, reason: 'response is not JSON', cause: parsed })
    return parsed
  }
}

// Server streaming over the Connect protocol: the request and every answer are enveloped
// as 1 flag byte, a 4 byte big-endian length, then JSON. Flag 2 marks the last envelope,
// which carries `{ error }` when the stream failed.
//
//   POST …/WatchGrokBotTranscripts  [0][len]{"cursors":[…]}
//   ◀── [0][len]{"connected":…} [0][len]{"rows":…} … [2][len]{}
export async function openStream({ accessToken, timeZone, method, body, signal }: { accessToken: string; timeZone: string; method: string; body: object; signal: AbortSignal }) {
  const json = new TextEncoder().encode(JSON.stringify(body))
  const envelope = new Uint8Array(5 + json.length)
  new DataView(envelope.buffer).setUint32(1, json.length)
  envelope.set(json, 5)
  const response = await fetch(`${BACKEND_URL}${SERVICE_PATH}/${method}`, {
    method: 'POST',
    redirect: 'manual',
    signal,
    headers: headers({ accessToken, timeZone, contentType: 'application/connect+json' }),
    body: envelope,
  }).catch((cause) => new GrokRequestError({ method, reason: 'request failed', cause }))
  if (response instanceof Error) return response
  if (response.status === 401) return new GrokAuthError({ reason: 'the login expired' })
  if (!response.ok || !response.body) return new GrokRequestError({ method, reason: errorReason({ status: response.status, text: await response.text().catch(() => '') }) })
  return readEnvelopes(response.body)
}

async function* readEnvelopes(body: ReadableStream<Uint8Array>): AsyncGenerator<{ last: boolean; message: unknown }> {
  const reader = body.getReader()
  let buffer = new Uint8Array(0)
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return
      const joined = new Uint8Array(buffer.length + value.length)
      joined.set(buffer)
      joined.set(value, buffer.length)
      buffer = joined
      while (buffer.length >= 5) {
        const length = new DataView(buffer.buffer, buffer.byteOffset).getUint32(1)
        if (buffer.length < 5 + length) break
        const text = new TextDecoder().decode(buffer.subarray(5, 5 + length))
        const last = (buffer[0] & 2) !== 0
        buffer = buffer.slice(5 + length)
        const message = errore.try(() => JSON.parse(text) as unknown)
        yield { last, message: message instanceof Error ? {} : message }
        if (last) return
      }
    }
  } finally {
    reader.releaseLock()
    await body.cancel().catch(() => {})
  }
}
