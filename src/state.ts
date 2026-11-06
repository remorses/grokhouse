// The page's one source of truth. Everything that happens is an OfficeEvent; `reduce`
// folds it into OfficeState with no I/O and no clock (times come in on the events).
// What the page shows is derived from that state by the pure functions at the bottom.
//
//   /api/office snapshot ──┐
//   /api/watch stream ─────┼──▶ dispatch(event) ──▶ reduce ──▶ OfficeState ──▶ derive ──▶ viewer + hud
//   clicks (send, read) ───┘
//
// Merging rules, so a slow response never overwrites newer data:
// - feed items are upserted by entry ID; the higher `updated` wins
// - live and read state are replaced only by a newer `at`
// - a new transcript generation (the bot's chat was cleared) replaces the feed
//
// Whether a bubble shows comes from the account's read state, shared with the Grok Bot
// app: a bot message newer than `lastViewedAt` is unread.

import type { BotSnapshot, Card, Cursor, FeedItem, Live, OfficeSnapshot, WatchEvent } from '../worker/protocol.ts'
import { orderBots } from './layout.ts'

const FEED_MAX = 30
const EVENT_LOG_MAX = 300
// A message sent from here shows the bot as busy at once; the stream catches up in seconds.
const OPTIMISTIC_MS = 10_000

export type Bot = Omit<BotSnapshot, 'feed'> & { feed: FeedItem[] }
export type Sent = { id: string; text: string; at: number }

export type OfficeState = {
  mode: 'demo' | 'live'
  email: string | null
  // In the order the rooms are laid out.
  bots: Bot[]
  selected: string | null
  // The last message sent from this page to each bot.
  sent: Record<string, Sent>
  // Read messages shown again on this page (the "…" nub, or selecting the bot). Not shared.
  opened: Record<string, string>
  signingIn: { url: string } | null
}

export type OfficeEvent =
  | { type: 'office.loaded'; mode: 'demo' | 'live'; office: OfficeSnapshot }
  | { type: 'feed.loaded'; botId: string; feed: FeedItem[]; todos: Bot['todos']; cursor: Cursor }
  | { type: 'watch'; event: WatchEvent }
  | { type: 'message.sent'; botId: string; sent: Sent }
  | { type: 'message.failed'; botId: string; id: string }
  | { type: 'bubble.opened'; botId: string; entryId: string }
  | { type: 'bubble.closed'; botId: string }
  | { type: 'bot.selected'; botId: string | null }
  | { type: 'signin.started'; url: string }
  | { type: 'signin.ended' }

export const initialState: OfficeState = { mode: 'demo', email: null, bots: [], selected: null, sent: {}, opened: {}, signingIn: null }

// ---------------- reduce ----------------
export function mergeFeed(feed: FeedItem[], items: FeedItem[], deleted: string[] = []) {
  const byId = new Map(feed.map((item) => [item.id, item]))
  for (const item of items) {
    const have = byId.get(item.id)
    if (!have || item.updated >= have.updated) byId.set(item.id, item)
  }
  for (const id of deleted) byId.delete(id)
  return [...byId.values()].sort((a, b) => a.seq - b.seq).slice(-FEED_MAX)
}

const newer = <T extends { at: number }>(have: T, next: T) => (next.at >= have.at ? next : have)

// A fetched feed against what the page has. The stream delivers every change up to the
// bot's cursor, so a snapshot that is behind it (older generation or lower seq) changes
// nothing; one at or past it is the truth up to its seq, plus stream items newer than that.
function applySnapshot(bot: Bot, snap: { feed: FeedItem[]; cursor: Cursor }): Pick<Bot, 'feed' | 'cursor'> {
  const { generation, seq } = snap.cursor
  if (generation < bot.cursor.generation || (generation === bot.cursor.generation && seq < bot.cursor.seq)) return { feed: bot.feed, cursor: bot.cursor }
  if (generation > bot.cursor.generation) return { feed: snap.feed, cursor: snap.cursor }
  return { feed: mergeFeed(snap.feed, bot.feed.filter((item) => item.updated > seq)), cursor: snap.cursor }
}

function mergeBot(have: Bot | undefined, next: BotSnapshot): Bot {
  if (!have) return next
  return { ...next, live: newer(have.live, next.live), read: newer(have.read, next.read), ...applySnapshot(have, next) }
}

function updateBot(state: OfficeState, botId: string, fn: (bot: Bot) => Bot): OfficeState {
  if (!state.bots.some((bot) => bot.bot.id === botId)) return state
  return { ...state, bots: state.bots.map((bot) => (bot.bot.id === botId ? fn(bot) : bot)) }
}

function reduceWatch(state: OfficeState, event: WatchEvent): OfficeState {
  if (event.type === 'live') return updateBot(state, event.botId, (bot) => ({ ...bot, live: newer(bot.live, event.live) }))
  if (event.type === 'read') return updateBot(state, event.botId, (bot) => ({ ...bot, read: newer(bot.read, event.read) }))
  if (event.type === 'rows')
    return updateBot(state, event.botId, (bot) => {
      if (event.generation > bot.cursor.generation) return { ...bot, feed: mergeFeed([], event.items), cursor: { generation: event.generation, seq: event.seq } }
      if (event.generation < bot.cursor.generation) return bot
      return { ...bot, feed: mergeFeed(bot.feed, event.items, event.deleted), cursor: { ...bot.cursor, seq: Math.max(bot.cursor.seq, event.seq) } }
    })
  // connected, heartbeat, roster, reset and end only trigger I/O (main.ts).
  return state
}

export function reduce(state: OfficeState, event: OfficeEvent): OfficeState {
  switch (event.type) {
    case 'office.loaded': {
      const have = new Map(state.bots.map((bot) => [bot.bot.id, bot]))
      const bots = orderBots(event.office.bots).map((next) => mergeBot(have.get(next.bot.id), next))
      const ids = new Set(bots.map((bot) => bot.bot.id))
      const modeChanged = event.mode !== state.mode
      return {
        ...state,
        mode: event.mode,
        email: event.office.email,
        bots,
        selected: state.selected && ids.has(state.selected) && !modeChanged ? state.selected : null,
        sent: modeChanged ? {} : state.sent,
        opened: modeChanged ? {} : state.opened,
        signingIn: null,
      }
    }
    case 'feed.loaded':
      return updateBot(state, event.botId, (bot) => ({ ...bot, todos: event.todos, ...applySnapshot(bot, event) }))
    case 'watch':
      return reduceWatch(state, event.event)
    case 'message.sent':
      return { ...state, sent: { ...state.sent, [event.botId]: event.sent } }
    case 'message.failed': {
      if (state.sent[event.botId]?.id !== event.id) return state
      const { [event.botId]: _failed, ...sent } = state.sent
      return { ...state, sent }
    }
    case 'bubble.opened':
      return { ...state, opened: { ...state.opened, [event.botId]: event.entryId } }
    case 'bubble.closed': {
      const { [event.botId]: _closed, ...opened } = state.opened
      return { ...state, opened }
    }
    case 'bot.selected': {
      // Leaving a bot folds away the message its selection opened.
      const { [state.selected ?? '']: _left, ...opened } = state.opened
      return { ...state, selected: event.botId, opened: state.selected && state.selected !== event.botId ? opened : state.opened }
    }
    case 'signin.started':
      return { ...state, signingIn: { url: event.url } }
    case 'signin.ended':
      return { ...state, signingIn: null }
  }
}

// A bounded log of what happened, for debugging (window.__office.events).
export function createEventLog() {
  const events: Array<{ at: number; event: OfficeEvent }> = []
  return {
    push(event: OfficeEvent) {
      events.push({ at: Date.now(), event })
      if (events.length > EVENT_LOG_MAX) events.shift()
    },
    events,
  }
}

// ---------------- derive ----------------
// What the mascot acts out: the live state, plus "busy" right after a send from here.
export type Presence = Live & { lastActivityAt: number | null }

export const latestBotMessage = (bot: Bot) => bot.feed.findLast((item) => item.who === 'bot' && item.kind !== 'tool' && item.kind !== 'event') ?? null

// The message sent from here that the bot has not answered yet.
export function pendingSent(state: OfficeState, bot: Bot) {
  const sent = state.sent[bot.bot.id]
  if (!sent) return null
  const answered = bot.feed.some((item) => item.who === 'bot' && item.kind !== 'tool' && item.at > sent.at)
  return answered ? null : sent
}

export function presenceOf(state: OfficeState, bot: Bot, now: number): Presence {
  const sent = pendingSent(state, bot)
  const lastActivityAt = Math.max(bot.read.lastActivityAt ?? 0, sent?.at ?? 0) || null
  if (sent && now - sent.at < OPTIMISTIC_MS && !bot.live.running && !bot.live.awaiting)
    return { ...bot.live, running: true, activity: { kind: 'thinking', tool: null, detail: null }, lastActivityAt }
  return { ...bot.live, lastActivityAt }
}

export type Bubble = {
  // Changes when the bubble shows something else, so it pops in again.
  key: string
  mine: boolean
  item: FeedItem | null
  text: string
  at: number
  card: Card | null
  unread: boolean
  // false: the bubble waits behind a "…" nub.
  visible: boolean
}

function cardText(item: FeedItem) {
  const card = item.card
  if (card?.type === 'choice') return card.prompt
  if (card?.type === 'approval') return `${card.title}${card.detail ? `\n\`${card.detail}\`` : ''}`
  return item.text
}

export function bubbleOf(state: OfficeState, bot: Bot): Bubble | null {
  const sent = pendingSent(state, bot)
  if (sent) return { key: `sent:${sent.id}`, mine: true, item: null, text: sent.text, at: sent.at, card: null, unread: false, visible: true }
  const item = latestBotMessage(bot)
  if (!item) return null
  const unread = item.at > (bot.read.lastViewedAt ?? 0)
  const visible = unread || state.opened[bot.bot.id] === item.id
  return { key: item.id, mine: false, item, text: cardText(item) || item.text, at: item.at, card: item.card, unread, visible }
}

export const cursorsOf = (state: OfficeState) => state.bots.map((bot) => ({ botId: bot.bot.id, ...bot.cursor }))
export const botById = (state: OfficeState, botId: string) => state.bots.find((bot) => bot.bot.id === botId) ?? null
