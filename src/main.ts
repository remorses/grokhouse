// Boot, I/O and side effects. All state lives in one store (state.ts) and only changes
// through dispatch(event); one subscribe pushes it to the canvas and the DOM.
//
//   /api/office (on start, on roster changes, every 5 min) ─┐
//   /api/watch  (one live stream: rows, live, read state) ──┼──▶ dispatch ──▶ store ──▶ subscribe ──▶ viewer + hud
//   clicks: send, answer, close bubble (marks read) ────────┘
//
// Signed out, a demo session plays the same kinds of events from demo.ts.

import './styles.css'
import { createStore } from 'zustand/vanilla'
import { setDither } from './engine/press.ts'
import type { Kind } from './engine/kinds.ts'
import { api } from './api.ts'
import { demoEvents, demoMarkRead, demoOffice, nextSeq } from './demo.ts'
import { planOffice } from './layout.ts'
import { createViewer } from './scene/viewer.ts'
import { createHud, type View } from './ui/hud.ts'
import { createSound } from './sound.ts'
import { botById, bubbleOf, createEventLog, cursorsOf, initialState, latestBotMessage, pendingSent, presenceOf, reduce, type OfficeEvent, type OfficeState } from './state.ts'
import type { Card, FeedItem, WatchEvent } from '../worker/protocol.ts'

const OFFICE_MS = 5 * 60_000
const DEMO_TICK_MS = 1_000
const LOGIN_POLL_MS = 2_000
const LOGIN_TIMEOUT_MS = 10 * 60_000
const RECONNECT_MIN_MS = 1_000
const RECONNECT_MAX_MS = 30_000
// Roster changes come in bursts (a rename touches several fields): reload once.
const ROSTER_DEBOUNCE_MS = 1_500

const view = document.querySelector<HTMLElement>('#view')!
const stage = document.querySelector<HTMLCanvasElement>('#stage')!

const store = createStore<OfficeState>(() => initialState)
const log = createEventLog()
function dispatch(...events: OfficeEvent[]) {
  for (const event of events) log.push(event)
  store.setState((state) => events.reduce(reduce, state), true)
}

let kinds: Record<string, Kind> = {}
const sound = createSound()

const viewer = createViewer({
  view,
  stage,
  onPick: (pick) => select(pick?.botId ?? null, { focus: !pick?.bot }),
})
const hud = createHud({
  layer: document.querySelector('#layer')!,
  topbar: document.querySelector('#topbar')!,
  strip: document.querySelector('#strip')!,
  drawer: document.querySelector('#drawer')!,
  toasts: document.querySelector('#toasts')!,
  viewer,
  sound,
  actions: {
    select: (id) => select(id, { focus: true }),
    send,
    answer,
    interrupt,
    closeBubble,
    openBubble: (botId, entryId) => {
      sound.play('tap', { pitch: 3 })
      dispatch({ type: 'bubble.opened', botId, entryId })
    },
    signIn,
    signOut,
  },
})
viewer.onFrame(() => hud.place())

// ---------------- state ──▶ screen ----------------
function viewOf(state: OfficeState, now: number): View {
  return {
    mode: state.mode,
    email: state.email,
    selected: state.selected,
    signingIn: state.signingIn,
    bots: state.bots.map((bot) => ({ bot, presence: presenceOf(state, bot, now), bubble: bubbleOf(state, bot), pending: pendingSent(state, bot) })),
  }
}

function render() {
  const state = store.getState()
  const now = Date.now()
  for (const bot of state.bots) viewer.setLive(bot.bot.id, presenceOf(state, bot, now))
  sound.setTypists(state.bots.filter((bot) => viewer.mood(bot.bot.id) === 'work').length)
  hud.update(viewOf(state, now))
}

// Each bot answers in its own pitch, so you can tell them apart by ear.
const pitchOf = (botId: string) => [0, 2, 4, 7, 9, -3, -5][parseInt(botId.replace(/-/g, '').slice(0, 6), 16) % 7]

// Sounds for what changed between two states. Loading the office (or switching mode)
// is silent: only news makes a sound.
function playChanges(state: OfficeState, prev: OfficeState) {
  if (state.mode !== prev.mode || !prev.bots.length) return
  for (const bot of state.bots) {
    const before = botById(prev, bot.bot.id)
    if (!before) continue
    const bubble = bubbleOf(state, bot)
    if (bubble && !bubble.mine && bubble.unread && bubble.key !== bubbleOf(prev, before)?.key) sound.play('reply', { pitch: pitchOf(bot.bot.id) })
    if (bot.live.awaiting && !before.live.awaiting) sound.play('needs')
    if (bot.live.running && !before.live.running) sound.play('wake', { pitch: pitchOf(bot.bot.id) / 2 })
  }
}

store.subscribe((state, prev) => {
  // A room is re-planned when its bot, schedules, todos or apps change; the viewer
  // re-prints only rooms whose plan really changed.
  const roomsOf = (s: OfficeState) => s.bots.map((b) => [b.bot, b.automations, b.todos, b.tools])
  const changed = state.bots.length !== prev.bots.length || roomsOf(state).some((parts, n) => parts.some((part, k) => part !== roomsOf(prev)[n]?.[k]))
  if (changed) {
    const now = Date.now()
    viewer.setOffice({
      plans: planOffice({ bots: state.bots, kinds }),
      kinds,
      lives: Object.fromEntries(state.bots.map((bot) => [bot.bot.id, presenceOf(state, bot, now)])),
      botLooks: Object.fromEntries(state.bots.map((b) => [b.bot.id, { shape: b.bot.shape, color: b.bot.color }])),
    })
  }
  playChanges(state, prev)
  render()
})

// ---------------- sessions ----------------
// A session owns the timers and the stream of one mode; switching mode stops it.
let session: { stop: () => void } | null = null
function switchSession(next: { stop: () => void }) {
  session?.stop()
  session = next
}

function startDemo() {
  dispatch({ type: 'office.loaded', mode: 'demo', office: demoOffice(Date.now()) })
  const timer = window.setInterval(() => dispatch(...demoEvents(Date.now()).map((event): OfficeEvent => ({ type: 'watch', event }))), DEMO_TICK_MS)
  switchSession({ stop: () => clearInterval(timer) })
}

async function startLive() {
  const office = await api.office()
  if (office instanceof Error) {
    hud.toast(office.message, true)
    return startDemo()
  }
  dispatch({ type: 'office.loaded', mode: 'live', office })
  const controller = new AbortController()
  const timer = window.setInterval(() => void reloadOffice(), OFFICE_MS)
  void watchLoop(controller.signal)
  switchSession({
    stop: () => {
      controller.abort()
      clearInterval(timer)
    },
  })
}

async function reloadOffice() {
  const office = await api.office()
  if (office instanceof Error) return console.warn('office reload failed', office.message)
  if (store.getState().mode === 'live') dispatch({ type: 'office.loaded', mode: 'live', office })
}

async function reloadFeed(botId: string) {
  const feed = await api.feed(botId)
  if (feed instanceof Error) return console.warn('feed reload failed', feed.message)
  dispatch({ type: 'feed.loaded', botId, feed: feed.feed, todos: feed.todos, cursor: feed.cursor })
}

// ---------------- the live stream ----------------
// Reconnects forever with backoff; each connection resumes from the cursors in the state,
// so rows missed while offline replay and live and read state arrive as a fresh snapshot.
async function watchLoop(signal: AbortSignal) {
  let wait = RECONNECT_MIN_MS
  let rosterTimer = 0
  const onEvent = (event: WatchEvent) => {
    const before = 'botId' in event ? botById(store.getState(), event.botId) : null
    dispatch({ type: 'watch', event })
    wait = RECONNECT_MIN_MS
    if (event.type === 'roster' || (event.type === 'rows' && !before)) {
      clearTimeout(rosterTimer)
      rosterTimer = window.setTimeout(() => void reloadOffice(), ROSTER_DEBOUNCE_MS)
    }
    if (event.type === 'reset' || (event.type === 'rows' && event.omitted)) void reloadFeed(event.botId)
    // A finished run may have changed the bot's todo list, which the stream does not carry.
    if (event.type === 'live' && before?.live.running && !event.live.running) void reloadFeed(event.botId)
  }
  while (!signal.aborted) {
    const result = await api.watch({ cursors: cursorsOf(store.getState()), signal, onEvent })
    if (signal.aborted) break
    if (result instanceof Error) {
      console.warn('live stream:', result.message)
      await new Promise((resolve) => setTimeout(resolve, wait))
      wait = Math.min(RECONNECT_MAX_MS, wait * 2)
    }
  }
  clearTimeout(rosterTimer)
}

// ---------------- actions ----------------
function select(id: string | null, { focus }: { focus: boolean }) {
  if (id) sound.play('tap')
  const bot = id ? botById(store.getState(), id) : null
  const latest = bot ? latestBotMessage(bot) : null
  dispatch({ type: 'bot.selected', botId: id }, ...(id && latest ? [{ type: 'bubble.opened', botId: id, entryId: latest.id } as const] : []))
  if (id && focus) viewer.focus(id)
  // Opening a bot reads it, like opening its chat in the app.
  if (id && bot && bubbleOf(store.getState(), bot)?.unread) void markRead(id)
}

// The read state only changes when the server (or the demo) says so: no local guess to undo.
async function markRead(botId: string) {
  if (store.getState().mode === 'demo') {
    demoMarkRead({ botId, at: Date.now() })
    return dispatch(...demoEvents(Date.now()).flatMap((event): OfficeEvent[] => (event.type === 'read' && event.botId === botId ? [{ type: 'watch', event }] : [])))
  }
  const result = await api.markRead(botId)
  if (result instanceof Error) return hud.toast(`Could not mark it read: ${result.message}`, true)
  dispatch({ type: 'watch', event: { type: 'read', botId, read: result.read } })
}

function closeBubble(botId: string) {
  const bot = botById(store.getState(), botId)
  const unread = bot ? bubbleOf(store.getState(), bot)?.unread : false
  sound.play('page')
  dispatch({ type: 'bubble.closed', botId })
  if (unread) void markRead(botId)
}

function demoReply({ botId, text }: { botId: string; text: string }) {
  const seq = nextSeq()
  const item: FeedItem = { id: `demo-${seq}`, seq, updated: seq, at: Date.now(), who: 'bot', kind: 'text', text, tool: null, app: null, card: null }
  dispatch({ type: 'watch', event: { type: 'rows', botId, generation: 1, items: [item], deleted: [], seq, omitted: false } })
}

async function send(botId: string, text: string) {
  const sent = { id: crypto.randomUUID(), text, at: Date.now() }
  sound.play('send')
  dispatch({ type: 'message.sent', botId, sent })
  void markRead(botId)
  if (store.getState().mode === 'demo') {
    setTimeout(() => demoReply({ botId, text: "On it! (This is the demo office: sign in and I'll be your real bot.)" }), 2200)
    return true
  }
  const result = await api.send({ id: botId, text, messageId: sent.id })
  if (result instanceof Error) {
    dispatch({ type: 'message.failed', botId, id: sent.id })
    hud.toast(result.message, true)
    return false
  }
  return true
}

async function answer(botId: string, card: Card, value: string) {
  if (store.getState().mode === 'demo') {
    const item = botById(store.getState(), botId)?.feed.find((x) => x.card?.entryId === card.entryId)
    const seq = nextSeq()
    if (item) dispatch({ type: 'watch', event: { type: 'rows', botId, generation: 1, items: [{ ...item, card: null, updated: seq }], deleted: [], seq, omitted: false } })
    demoReply({ botId, text: value === 'now' ? 'Posting it now 🚀' : 'Okay, queued for 8:30.' })
    return true
  }
  const result = await api.answer({ id: botId, entryId: card.entryId, value })
  if (result instanceof Error) {
    hud.toast(result.message, true)
    return false
  }
  hud.toast('Answered')
  return true
}

async function interrupt(botId: string) {
  if (store.getState().mode === 'demo') return hud.toast('Demo bots never stop. Sign in to control yours.')
  const result = await api.interrupt(botId)
  if (result instanceof Error) return hud.toast(result.message, true)
  hud.toast('Stopped')
}

async function signIn() {
  // Open the tab inside the click, so popup blockers allow it.
  const tab = window.open('about:blank', '_blank')
  const login = await api.login()
  if (login instanceof Error) {
    tab?.close()
    return hud.toast(login.message, true)
  }
  if (tab) tab.location.href = login.url
  dispatch({ type: 'signin.started', url: login.url })
  const deadline = Date.now() + LOGIN_TIMEOUT_MS
  while (Date.now() < deadline && store.getState().signingIn) {
    await new Promise((resolve) => setTimeout(resolve, LOGIN_POLL_MS))
    const poll = await api.pollLogin()
    if (poll instanceof Error) {
      hud.toast(poll.message, true)
      break
    }
    if (!poll.done) continue
    hud.toast(`Signed in${poll.email ? ` as ${poll.email}` : ''}. Opening your office…`)
    tab?.close()
    return startLive()
  }
  dispatch({ type: 'signin.ended' })
}

async function signOut() {
  const result = await api.logout()
  if (result instanceof Error) return hud.toast(result.message, true)
  hud.toast('Signed out')
  startDemo()
}

// ---------------- boot ----------------
async function main() {
  // Flat washes at the printed tones, no dither screen: reads as a toon.
  setDither(false)
  const res = await fetch('/kinds.json')
  kinds = (await res.json()) as Record<string, Kind>
  viewer.start()
  // ?demo shows the made-up office even when signed in.
  const me = new URLSearchParams(location.search).has('demo') ? null : await api.me()
  if (!me || me instanceof Error || !me.signedIn) startDemo()
  else await startLive()
  // Moods and "2m ago" labels move with the clock; refresh them once a second.
  window.setInterval(render, 1000)
  window.__office = { store, events: log.events, viewer: viewer.debug, glideTo: viewer.glideTo }
}

void main()

declare global {
  interface Window {
    __office?: unknown
  }
}
