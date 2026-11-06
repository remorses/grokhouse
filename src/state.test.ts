import { expect, test } from 'vitest'
import { bubbleOf, cursorsOf, initialState, reduce, type OfficeEvent, type OfficeState } from './state.ts'
import type { BotSnapshot, FeedItem, OfficeSnapshot } from '../worker/protocol.ts'

const BOT = '00000000-0000-4000-8000-000000000001'

const item = (id: string, seq: number, at: number, text: string, updated = seq): FeedItem => ({ id, seq, updated, at, who: 'bot', kind: 'text', text, tool: null, app: null, card: null })

function snapshot({ feed, lastViewedAt, at }: { feed: FeedItem[]; lastViewedAt: number | null; at: number }): OfficeSnapshot {
  const bot: BotSnapshot = {
    bot: { id: BOT, name: 'botter', description: null, shape: 'cloud', color: 'violet', isGroup: false, createdAt: null },
    live: { at, running: false, composing: false, retrying: false, activity: null, awaiting: null, subagents: false },
    read: { at, lastViewedAt, lastActivityAt: null, lastEntryId: null, unread: 0 },
    cursor: { generation: 1, seq: Math.max(0, ...feed.map((x) => x.updated)) },
    automations: [],
    todos: [],
    feed,
    tools: [],
  }
  return { email: null, at, bots: [bot] }
}

const play = (events: OfficeEvent[], from: OfficeState = initialState) => events.reduce(reduce, from)
const bubble = (state: OfficeState) => {
  const b = bubbleOf(state, state.bots[0])
  return b && { text: b.text, unread: b.unread, visible: b.visible }
}

test('a late office snapshot never undoes newer stream rows or read state', () => {
  const state = play([
    { type: 'office.loaded', mode: 'live', office: snapshot({ feed: [item('a', 1, 100, 'old')], lastViewedAt: 50, at: 1 }) },
    // The bot answers and the user reads it in the desktop app, both over the stream.
    { type: 'watch', event: { type: 'rows', botId: BOT, generation: 1, items: [item('b', 2, 200, 'streaming…'), item('b', 2, 200, 'done', 3)], deleted: [], seq: 3, omitted: false } },
    { type: 'watch', event: { type: 'read', botId: BOT, read: { at: 10, lastViewedAt: 250, lastActivityAt: 200, lastEntryId: 'b', unread: 0 } } },
    // A snapshot fetched before all that lands last.
    { type: 'office.loaded', mode: 'live', office: snapshot({ feed: [item('a', 1, 100, 'old'), item('b', 2, 200, 'streaming…')], lastViewedAt: 50, at: 5 }) },
  ])
  expect(state.bots[0].feed.map((x) => x.text)).toEqual(['old', 'done'])
  expect(cursorsOf(state)).toEqual([{ botId: BOT, generation: 1, seq: 3 }])
  // Read elsewhere: the bubble waits behind its nub.
  expect(bubble(state)).toEqual({ text: 'done', unread: false, visible: false })
})

test('a bubble shows while unread, hides when read, and reopens from the nub', () => {
  const loaded = play([{ type: 'office.loaded', mode: 'live', office: snapshot({ feed: [item('a', 1, 100, 'hi')], lastViewedAt: 50, at: 1 }) }])
  expect(bubble(loaded)).toEqual({ text: 'hi', unread: true, visible: true })
  const read = play([{ type: 'watch', event: { type: 'read', botId: BOT, read: { at: 2, lastViewedAt: 150, lastActivityAt: 100, lastEntryId: 'a', unread: 0 } } }], loaded)
  expect(bubble(read)).toEqual({ text: 'hi', unread: false, visible: false })
  const opened = play([{ type: 'bubble.opened', botId: BOT, entryId: 'a' }], read)
  expect(bubble(opened)?.visible).toBe(true)
  // Selecting another bot folds a bubble that selecting this one opened.
  const left = play([{ type: 'bot.selected', botId: BOT }, { type: 'bot.selected', botId: null }], opened)
  expect(bubble(left)?.visible).toBe(false)
  // A newer message is unread again.
  const next = play([{ type: 'watch', event: { type: 'rows', botId: BOT, generation: 1, items: [item('c', 2, 300, 'again')], deleted: [], seq: 2, omitted: false } }], left)
  expect(bubble(next)).toEqual({ text: 'again', unread: true, visible: true })
})

test('a cleared transcript (new generation) replaces the feed', () => {
  const state = play([
    { type: 'office.loaded', mode: 'live', office: snapshot({ feed: [item('a', 5, 100, 'old')], lastViewedAt: null, at: 1 }) },
    { type: 'watch', event: { type: 'rows', botId: BOT, generation: 2, items: [item('n', 1, 400, 'fresh')], deleted: [], seq: 1, omitted: false } },
  ])
  expect(state.bots[0].feed.map((x) => x.text)).toEqual(['fresh'])
  expect(cursorsOf(state)).toEqual([{ botId: BOT, generation: 2, seq: 1 }])
})

test('a snapshot behind the stream never brings back deleted or cleared entries', () => {
  const loaded = play([{ type: 'office.loaded', mode: 'live', office: snapshot({ feed: [item('a', 1, 100, 'one'), item('b', 2, 200, 'two')], lastViewedAt: null, at: 1 }) }])
  const deleted = play([{ type: 'watch', event: { type: 'rows', botId: BOT, generation: 1, items: [], deleted: ['b'], seq: 10, omitted: false } }], loaded)
  const stale = play([{ type: 'feed.loaded', botId: BOT, feed: [item('a', 1, 100, 'one'), item('b', 2, 200, 'two')], todos: [], cursor: { generation: 1, seq: 2 } }], deleted)
  expect(stale.bots[0].feed.map((x) => x.id)).toEqual(['a'])
  const cleared = play([{ type: 'watch', event: { type: 'rows', botId: BOT, generation: 2, items: [item('n', 1, 400, 'fresh')], deleted: [], seq: 1, omitted: false } }], stale)
  const old = play([{ type: 'feed.loaded', botId: BOT, feed: [item('a', 1, 100, 'one')], todos: [], cursor: { generation: 1, seq: 12 } }], cleared)
  expect(old.bots[0].feed.map((x) => x.id)).toEqual(['n'])
  expect(cursorsOf(old)).toEqual([{ botId: BOT, generation: 2, seq: 1 }])
})
