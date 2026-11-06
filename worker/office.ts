// Everything the office shows, read from GrokBotService and flattened for the page.
//
//   ListGrokBotAgents ──────────────┐
//   ListGrokBotAgentStatuses ───────┤  live state, last message preview
//   ListGrokBotAccountAutomations ──┼──▶ OfficeSnapshot
//   ListGrokBotTranscriptEntries ───┤  per bot: chat, app tool calls, cards
//   ListGrokBotAgentTodos ──────────┘  per bot: the bot's own todo list
//
// Transcript rows carry base64 JSON entries; the shapes are documented in kimakivoice
// opencode-grok-bot/src/transcript.ts. Tool calls only show as `mcp-app` entries and as
// the live `activity` of a running bot; shell and browser work stays on the bot's box.

import * as errore from 'errore'
import { decodeBase64Utf8, GrokRequestError, type GrokCall } from './grok.ts'
import type { Automation, BotInfo, BotSnapshot, Card, CardReply, Cursor, FeedItem, Live, ReadState, Todo, WatchEvent } from './protocol.ts'

const FEED_ENTRIES = 30
const FEED_ITEMS = 30
// Each bot costs two subrequests; a Worker request may make 50.
const MAX_BOTS = 20

type ServerAgent = {
  agentId?: string
  name?: string
  description?: string | null
  kind?: string
  avatarShape?: string | null
  avatarColor?: string | null
  createdAtMs?: string
}

type ServerLive = {
  agentId?: string
  isRunning?: boolean
  isComposingMessage?: boolean
  isRetrying?: boolean
  activity?: { kind?: string; tool?: string; detail?: string } | null
  awaiting?: { reason?: string } | null
  hasRunningSubagents?: boolean
  updatedAtMs?: string
}
type ServerClient = {
  agentId?: string
  lastViewedAtMs?: string
  lastActivityAtMs?: string
  lastEntryId?: string
  unreadCount?: number
  updatedAtMs?: string
}
type ServerStatus = { agentId?: string; isRunning?: boolean; live?: ServerLive; client?: ServerClient }
// A transcript row: `body` is base64 JSON, left out when bigger than the inline limit.
type ServerRow = { seq?: string; updatedSeq?: string; entryId?: string; body?: string; bodyOmitted?: boolean }

type CardBody = {
  status?: string
  requestId?: string
  command?: string
  summary?: string
  action?: string
  description?: string
  reason?: string
  serverName?: string
  serverId?: string
}

type Entry = {
  id: string
  kind: string
  seq?: number
  timestampMs?: number
  role?: string
  content?: unknown
  text?: string
  richText?: string
  summary?: string
  hidden?: boolean
  isStreaming?: boolean
  fromAgent?: { name?: string }
  author?: { name?: string }
  message?: {
    type?: string
    content?: string
    text?: string
    title?: string
    body?: string
    name?: string
    file_name?: string
    url?: string
    widget?: { prompt?: string; options?: Array<{ label?: string; value?: string; description?: string }>; multiSelect?: boolean }
    approval?: CardBody
    ask?: CardBody
  }
  respondedValue?: string | null
  widgetDismissed?: boolean
  widgetSkipped?: boolean
  serverName?: string
  toolName?: string
  name?: string
  event?: { type?: string; action?: string; automationName?: string }
}

function first(...values: Array<string | null | undefined>) {
  return values.find((value) => typeof value === 'string' && value.trim() !== '')?.trim() ?? ''
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(contentText).filter(Boolean).join('\n')
  if (content && typeof content === 'object') {
    const value = content as { text?: unknown; content?: unknown }
    if (typeof value.text === 'string') return value.text
    if (value.content !== undefined) return contentText(value.content)
  }
  return ''
}

// User prompts are a ProseMirror doc in `richText`.
function richText(json: string | undefined) {
  if (!json) return ''
  const doc = errore.try(() => JSON.parse(json) as unknown)
  if (doc instanceof Error) return ''
  const walk = (node: unknown): string => {
    if (!node || typeof node !== 'object') return ''
    const value = node as { type?: string; text?: string; content?: unknown[] }
    if (typeof value.text === 'string') return value.text
    const inner = (value.content ?? []).map(walk).join('')
    return value.type === 'paragraph' ? `${inner}\n` : inner
  }
  return walk(doc).trim()
}

export function toBot(agent: ServerAgent): BotInfo | null {
  if (!agent.agentId || !agent.name) return null
  return {
    id: agent.agentId,
    name: agent.name,
    description: agent.description ?? null,
    shape: agent.avatarShape || 'blob',
    color: agent.avatarColor || 'black',
    isGroup: agent.kind === 'GROK_BOT_AGENT_KIND_ROOM',
    createdAt: agent.createdAtMs ? Number(agent.createdAtMs) : null,
  }
}

const ms = (value: string | undefined) => (value ? Number(value) : null)

export function toLive(live: ServerLive | undefined): Live {
  const activity = live?.activity
  return {
    at: ms(live?.updatedAtMs) ?? 0,
    running: live?.isRunning === true || live?.isComposingMessage === true,
    composing: live?.isComposingMessage === true,
    retrying: live?.isRetrying === true,
    activity: activity?.kind ? { kind: activity.kind, tool: activity.tool || null, detail: activity.detail || null } : null,
    awaiting: live?.awaiting ? first(live.awaiting.reason, 'your answer') : null,
    subagents: live?.hasRunningSubagents === true,
  }
}

export function toRead(client: ServerClient | undefined): ReadState {
  return {
    at: ms(client?.updatedAtMs) ?? 0,
    lastViewedAt: ms(client?.lastViewedAtMs),
    lastActivityAt: ms(client?.lastActivityAtMs),
    lastEntryId: client?.lastEntryId ?? null,
    unread: client?.unreadCount ?? 0,
  }
}

function pendingCard(entry: Entry): Card | null {
  const message = entry.message
  if (entry.kind !== 'send-message' || !message) return null
  if (message.type === 'widget' && message.widget && typeof entry.respondedValue !== 'string' && !entry.widgetDismissed && !entry.widgetSkipped) {
    return {
      type: 'choice',
      entryId: entry.id,
      prompt: message.widget.prompt ?? '',
      multi: message.widget.multiSelect === true,
      options: (message.widget.options ?? []).flatMap((option) => {
        const value = option.value ?? option.label
        return value ? [{ label: option.label ?? value, value, description: option.description ?? null }] : []
      }),
    }
  }
  const card = message.approval ?? message.ask
  if (card?.status !== 'pending' || !card.requestId) return null
  if (message.type === 'connector-grant') return { type: 'grant', entryId: entry.id, requestId: card.requestId, app: first(message.ask?.serverName, message.ask?.serverId, 'an app') }
  if (message.type === 'auto-review-approval' || message.type === 'local-tool-permission') {
    return {
      type: 'approval',
      entryId: entry.id,
      requestId: card.requestId,
      flavor: message.type === 'auto-review-approval' ? 'auto-review' : 'local-tool',
      title: first(card.summary, card.action, 'Approval needed'),
      detail: first(card.command, card.description, card.reason),
    }
  }
  return null
}

function sendMessageText(entry: Entry) {
  const message = entry.message!
  const type = message.type ?? 'message'
  if (type === 'text') return { kind: 'text' as const, text: first(message.content, message.text) }
  if (type === 'attachment') return { kind: 'file' as const, text: first(message.file_name, message.name, 'a file') }
  if (type === 'widget') return { kind: 'card' as const, text: first(message.widget?.prompt, 'A question') }
  if (type === 'connector') return { kind: 'event' as const, text: 'Asked to connect an app' }
  if (type === 'connector-grant') return { kind: 'card' as const, text: `${first(message.ask?.serverName, 'An app')} wants access` }
  if (type === 'user-form') return { kind: 'card' as const, text: 'Asked you to fill a form' }
  if (type === 'secret-request') return { kind: 'card' as const, text: 'Asked for a secret' }
  if (type.endsWith('-draft')) return { kind: 'card' as const, text: `Wrote a ${type.replace(/-draft$/, '')} draft` }
  const card = message.approval ?? message.ask
  if (card) return { kind: 'card' as const, text: first(card.summary, card.action, card.description, 'Approval needed') }
  return { kind: 'text' as const, text: first(message.content, message.text, message.body, message.title) }
}

function feedItem(entry: Entry & { seq: number; updated: number }): FeedItem | null {
  if (entry.hidden) return null
  const at = entry.timestampMs ?? 0
  const base = { id: entry.id, seq: entry.seq, updated: entry.updated, at, tool: null, app: null, card: null }
  if (entry.kind === 'send-message' && entry.message) {
    const { kind, text } = sendMessageText(entry)
    if (!text) return null
    return { ...base, who: 'bot', kind, text, card: pendingCard(entry) }
  }
  if (entry.kind === 'message') {
    const text = first(richText(entry.richText), contentText(entry.content), entry.text)
    if (!text) return null
    const who = entry.role === 'assistant' ? 'bot' : entry.fromAgent || entry.author?.name ? 'other' : 'user'
    return { ...base, who, kind: 'text', text }
  }
  if (entry.kind === 'mcp-app' || entry.kind === 'tool-call') {
    const tool = first(entry.toolName, entry.name, 'tool').replace(/ToolCall$/, '')
    const app = first(entry.serverName) || null
    return { ...base, who: 'bot', kind: 'tool', text: app ? `${app}: ${tool}` : tool, tool, app }
  }
  if (entry.kind === 'event' && entry.event) {
    const what = first(entry.event.automationName, entry.event.type)
    return { ...base, who: 'other', kind: 'event', text: [entry.event.action, what].filter(Boolean).join(' ') }
  }
  if (entry.kind === 'notice') {
    const text = first(entry.text, contentText(entry.content), entry.summary)
    return text ? { ...base, who: 'other', kind: 'event', text } : null
  }
  return null
}

// Rows to feed items, in transcript order. Rows the office does not show are skipped.
function toItems(rows: ServerRow[]) {
  return rows
    .flatMap((row) => {
      if (!row.body) return []
      const entry = errore.try(() => JSON.parse(decodeBase64Utf8(row.body ?? '')) as Entry)
      if (entry instanceof Error || typeof entry?.id !== 'string') return []
      const item = feedItem({ ...entry, seq: Number(row.seq), updated: Number(row.updatedSeq ?? row.seq) })
      return item ? [item] : []
    })
    .sort((a, b) => a.seq - b.seq)
}
const maxSeq = (rows: ServerRow[]) => rows.reduce((max, row) => Math.max(max, Number(row.updatedSeq ?? row.seq ?? 0)), 0)

export async function readFeed({ call, agentId }: { call: GrokCall; agentId: string }) {
  const page = await call<{ entries?: ServerRow[]; generation?: number }>({ method: 'ListGrokBotTranscriptEntries', body: { agentId, limit: FEED_ENTRIES } })
  if (page instanceof Error) return page
  const rows = page.entries ?? []
  return { items: toItems(rows), cursor: { generation: page.generation ?? 0, seq: maxSeq(rows) } satisfies Cursor }
}

const TODO_STATUS: Record<string, Todo['status']> = {
  TODO_STATUS_PENDING: 'todo',
  TODO_STATUS_IN_PROGRESS: 'doing',
  TODO_STATUS_COMPLETED: 'done',
  TODO_STATUS_CANCELLED: 'cancelled',
}

export async function readTodos({ call, agentId }: { call: GrokCall; agentId: string }) {
  const result = await call<{ todos?: Array<{ id?: string; content?: string; status?: string }> }>({ method: 'ListGrokBotAgentTodos', body: { agentId } })
  if (result instanceof Error) return result
  return (result.todos ?? []).flatMap((todo): Todo[] => (todo.id && todo.content ? [{ id: todo.id, text: todo.content, status: TODO_STATUS[todo.status ?? ''] ?? 'todo' }] : []))
}

type AutomationRecord = {
  id?: string
  name?: string
  prompt?: string
  trigger?: { type?: string }
  triggerDescription?: string
  isEnabled?: boolean
  nextRunAt?: number
  lastRunAt?: number
  runs?: Array<{ status?: string; startedAt?: number }>
}

function toAutomation(raw: { automationId?: string; recordJson?: string }): Automation | null {
  const record = errore.try(() => JSON.parse(raw.recordJson ?? '{}') as AutomationRecord)
  if (record instanceof Error) return null
  const id = record.id ?? raw.automationId
  if (!id) return null
  const runs = record.runs ?? []
  return {
    id,
    name: first(record.name, id),
    prompt: record.prompt ?? '',
    when: first(record.triggerDescription, record.trigger?.type, 'on a trigger'),
    trigger: record.trigger?.type ?? 'unknown',
    enabled: record.isEnabled !== false,
    nextRunAt: record.nextRunAt ?? null,
    lastRunAt: record.lastRunAt ?? null,
    lastStatus: runs[0]?.status ?? null,
    runs: runs.length,
  }
}

async function readStatuses({ call, ids }: { call: GrokCall; ids: string[] }) {
  if (!ids.length) return {}
  const result = await call<{ statuses?: ServerStatus[] }>({ method: 'ListGrokBotAgentStatuses', body: { agentIds: ids } })
  if (result instanceof Error) return result
  return Object.fromEntries(
    ids.map((id) => {
      const status = result.statuses?.find((s) => s.agentId === id)
      const running = status?.isRunning === true || status?.live?.isRunning === true
      return [id, { live: toLive({ ...status?.live, isRunning: running }), read: toRead(status?.client) }]
    }),
  )
}

// Apps and tools in the feed, most used first.
function toolsOf(feed: FeedItem[]) {
  const counts = new Map<string, number>()
  for (const item of feed) if (item.kind === 'tool') counts.set(item.app ?? item.tool ?? 'tool', (counts.get(item.app ?? item.tool ?? 'tool') ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1]).map(([name]) => name)
}

export async function readOffice({ call, timeZone }: { call: GrokCall; timeZone: string }) {
  const agents = await call<{ agents?: ServerAgent[] }>({ method: 'ListGrokBotAgents', body: {} })
  if (agents instanceof Error) return agents
  const bots = (agents.agents ?? []).map(toBot).filter((bot): bot is BotInfo => bot !== null).slice(0, MAX_BOTS)
  const ids = bots.map((bot) => bot.id)
  const [statuses, automations, perBot] = await Promise.all([
    readStatuses({ call, ids }),
    call<{ agents?: Array<{ agentId?: string; automations?: Array<{ automationId?: string; recordJson?: string }> }> }>({
      method: 'ListGrokBotAccountAutomations',
      body: { timeZone, agentIds: ids },
    }),
    Promise.all(bots.map((bot) => Promise.all([readFeed({ call, agentId: bot.id }), readTodos({ call, agentId: bot.id })]))),
  ])
  if (statuses instanceof Error) return statuses
  if (automations instanceof Error) console.warn('automations unavailable:', automations.message)
  return bots.map((bot, index): BotSnapshot => {
    const [feed, todos] = perBot[index]
    if (feed instanceof Error) console.warn(`feed of ${bot.name} unavailable:`, feed.message)
    if (todos instanceof Error) console.warn(`todos of ${bot.name} unavailable:`, todos.message)
    const items = feed instanceof Error ? [] : feed.items
    const own = automations instanceof Error ? [] : (automations.agents?.find((agent) => agent.agentId === bot.id)?.automations ?? [])
    return {
      bot,
      live: statuses[bot.id]?.live ?? toLive(undefined),
      read: statuses[bot.id]?.read ?? toRead(undefined),
      cursor: feed instanceof Error ? { generation: 0, seq: 0 } : feed.cursor,
      automations: own.map(toAutomation).filter((item): item is Automation => item !== null),
      todos: todos instanceof Error ? [] : todos,
      feed: items.slice(-FEED_ITEMS),
      tools: toolsOf(items),
    }
  })
}

const DELIVERED = new Set(['GROK_BOT_USER_MESSAGE_DELIVERY_ACCEPTED_BOX', 'GROK_BOT_USER_MESSAGE_DELIVERY_ACCEPTED_TEMPORAL', 'GROK_BOT_USER_MESSAGE_DELIVERY_DUPLICATE'])

// `messageId` becomes the prompt's `clientNonce`: sending the same ID again is a duplicate.
export async function sendMessage({ call, agentId, text, messageId }: { call: GrokCall; agentId: string; text: string; messageId: string }) {
  const method = 'SendGrokBotUserMessage'
  const now = String(Date.now())
  const sent = await call<{ delivery?: string; refusal?: { message?: string; failureCode?: string } }>({
    method,
    body: {
      agentId,
      messageId,
      text,
      sentAtMs: now,
      composedAtMs: now,
      source: 'GROK_BOT_CLIENT_SURFACE_DESKTOP',
      initiator: 'GROK_BOT_USER_MESSAGE_INITIATOR_USER',
      sendSource: 'GROK_BOT_SEND_SOURCE_CHAT',
    },
  })
  if (sent instanceof Error) return sent
  if (sent.delivery && DELIVERED.has(sent.delivery)) return null
  return new GrokRequestError({ method, reason: first(sent.refusal?.message, sent.refusal?.failureCode, `not delivered (${sent.delivery ?? 'no status'})`) })
}

export async function interrupt({ call, agentId }: { call: GrokCall; agentId: string }) {
  const result = await call({ method: 'InterruptGrokBotAgentRun', body: { agentId, reason: 'user_interrupt' } })
  return result instanceof Error ? result : null
}

const APPROVAL: Record<string, Record<string, string>> = {
  'auto-review': { approve: 'GROK_BOT_AUTO_REVIEW_APPROVAL_RESOLUTION_APPROVED', always: 'GROK_BOT_AUTO_REVIEW_APPROVAL_RESOLUTION_ALWAYS', deny: 'GROK_BOT_AUTO_REVIEW_APPROVAL_RESOLUTION_DENIED' },
  'local-tool': { approve: 'GROK_BOT_LOCAL_TOOL_PERMISSION_CARD_RESOLUTION_ALLOW_ONCE', always: 'GROK_BOT_LOCAL_TOOL_PERMISSION_CARD_RESOLUTION_ALWAYS', deny: 'GROK_BOT_LOCAL_TOOL_PERMISSION_CARD_RESOLUTION_DENY' },
  grant: { approve: 'GROK_BOT_CONNECTOR_GRANT_RESOLUTION_ALLOWED', always: 'GROK_BOT_CONNECTOR_GRANT_RESOLUTION_ALWAYS_THIS_BOT', deny: 'GROK_BOT_CONNECTOR_GRANT_RESOLUTION_SKIPPED' },
}

// Answers the pending card `entryId`, like clicking it in the app. The card is read again so
// the page only sends the entry ID and the chosen value.
export async function answerCard({ call, agentId, reply }: { call: GrokCall; agentId: string; reply: CardReply }) {
  const feed = await readFeed({ call, agentId })
  if (feed instanceof Error) return feed
  const card = feed.items.find((item) => item.card?.entryId === reply.entryId)?.card
  if (!card) return new GrokRequestError({ method: 'answer', reason: 'that card is no longer waiting for an answer' })
  if (card.type === 'choice') return checked(await call({ method: 'RespondGrokBotWidget', body: { agentId, entryId: card.entryId, value: reply.value } }), 'RespondGrokBotWidget')
  const resolution = APPROVAL[card.type === 'grant' ? 'grant' : card.flavor][reply.value]
  if (!resolution) return new GrokRequestError({ method: 'answer', reason: `unknown answer "${reply.value}"` })
  if (card.type === 'grant') return checked(await call({ method: 'ResolveGrokBotConnectorGrant', body: { agentId, entryId: card.entryId, requestId: card.requestId, resolution } }), 'ResolveGrokBotConnectorGrant')
  if (card.flavor === 'auto-review') return checked(await call({ method: 'ResolveGrokBotAutoReviewApproval', body: { agentId, requestId: card.requestId, resolution, approvalPlatform: 'desktop' } }), 'ResolveGrokBotAutoReviewApproval')
  return checked(await call({ method: 'ResolveGrokBotLocalToolPermission', body: { agentId, entryId: card.entryId, requestId: card.requestId, resolution } }), 'ResolveGrokBotLocalToolPermission')
}

function checked(result: unknown, method: string) {
  if (result instanceof Error) return result
  const refusal = (result as { refusal?: { message?: string; failureCode?: string } } | null)?.refusal
  return refusal ? new GrokRequestError({ method, reason: first(refusal.message, refusal.failureCode, 'refused') }) : null
}

// Marks the bot read for the whole account, like opening its chat in the app.
export async function markRead({ call, agentId }: { call: GrokCall; agentId: string }) {
  const result = await call<{ state?: ServerClient }>({ method: 'SetGrokBotAgentClientState', body: { agentId, markRead: true } })
  return result instanceof Error ? result : toRead(result.state)
}

// ---------------- the watch stream ----------------
// One frame of WatchGrokBotTranscripts (a oneof) to the events the page understands.
type WatchFrame = {
  connected?: { serverTimeMs?: string }
  heartbeat?: { serverTimeMs?: string }
  rows?: { agentId?: string; generation?: number; entries?: ServerRow[]; deletes?: ServerRow[] }
  cleared?: { agentId?: string }
  cursorTooOld?: { agentId?: string }
  agentState?: { live?: ServerLive[]; client?: ServerClient[] }
  rosterChanged?: { agentId?: string }
}

export function toWatchEvents(frame: WatchFrame): WatchEvent[] {
  if (frame.connected) return [{ type: 'connected', at: ms(frame.connected.serverTimeMs) ?? Date.now() }]
  if (frame.heartbeat) return [{ type: 'heartbeat', at: ms(frame.heartbeat.serverTimeMs) ?? Date.now() }]
  if (frame.rows?.agentId) {
    const rows = frame.rows.entries ?? []
    const deletes = frame.rows.deletes ?? []
    return [
      {
        type: 'rows',
        botId: frame.rows.agentId,
        generation: frame.rows.generation ?? 0,
        items: toItems(rows),
        deleted: deletes.flatMap((row) => (row.entryId ? [row.entryId] : [])),
        seq: Math.max(maxSeq(rows), maxSeq(deletes)),
        omitted: rows.some((row) => row.bodyOmitted),
      },
    ]
  }
  const reset = frame.cleared?.agentId ?? frame.cursorTooOld?.agentId
  if (reset) return [{ type: 'reset', botId: reset }]
  if (frame.rosterChanged) return [{ type: 'roster', botId: frame.rosterChanged.agentId ?? '' }]
  if (frame.agentState) {
    const lives = (frame.agentState.live ?? []).flatMap((live): WatchEvent[] => (live.agentId ? [{ type: 'live', botId: live.agentId, live: toLive(live) }] : []))
    const reads = (frame.agentState.client ?? []).flatMap((client): WatchEvent[] => (client.agentId ? [{ type: 'read', botId: client.agentId, read: toRead(client) }] : []))
    return [...lives, ...reads]
  }
  return []
}
