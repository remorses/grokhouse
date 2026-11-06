// The office before sign-in: made-up bots that act out a day on a loop, so the page
// shows what it does. Nothing here talks to Grok Bot: the loop emits the same live and
// read events the real /api/watch stream does.

import type { BotSnapshot, FeedItem, Live, OfficeSnapshot, ReadState, WatchEvent } from '../worker/protocol.ts'

const MIN = 60_000
const HOUR = 60 * MIN

function live(partial: Partial<Live> & { at: number }): Live {
  return { running: false, composing: false, retrying: false, activity: null, awaiting: null, subagents: false, ...partial }
}

let seq = 0
export function say({ id, ago, who = 'bot', text, kind = 'text' }: { id: string; ago: number; who?: FeedItem['who']; text: string; kind?: FeedItem['kind'] }): FeedItem {
  seq += 1
  return { id, seq, updated: seq, at: Date.now() - ago, who, kind, text, tool: kind === 'tool' ? text.split(': ')[1] ?? text : null, app: kind === 'tool' ? text.split(': ')[0] : null, card: null }
}
// The next transcript position for an item made up later (a demo reply).
export const nextSeq = () => ++seq

// `seen`: the user already read its last message, so its bubble waits behind a nub.
type DemoBot = Omit<BotSnapshot, 'live' | 'read' | 'cursor'> & { seen?: boolean; script: Array<{ s: number; live: Partial<Live> }> }

const bot = (id: string, name: string, shape: string, color: string, description: string | null) => ({ id, name, shape, color, description, isGroup: false, createdAt: null })

const BOTS: DemoBot[] = [
  {
    bot: bot('00000000-0000-4000-8000-000000000001', 'Grok Bot', 'blob', 'black', "The user's primary bot. Routes every task to the right bot."),
    automations: [],
    todos: [],
    tools: [],
    feed: [
      say({ id: 'a1', ago: 40 * MIN, who: 'user', text: 'find me a cheaper iPhone 15' }),
      say({ id: 'a2', ago: 39 * MIN, text: 'Handed it to **Price Scout**. It checks Swappie every morning and pings you when the price drops.' }),
    ],
    script: [
      { s: 0, live: {} },
      { s: 50, live: { running: true, activity: { kind: 'thinking', tool: null, detail: null } } },
      { s: 62, live: {} },
    ],
  },
  {
    bot: bot('00000000-0000-4000-8000-000000000002', 'Price Scout', 'square', 'yellow', 'Watches prices and tells you about drops.'),
    automations: [
      { id: 'w1', name: 'Swappie iPhone 15 price watch', prompt: 'Check the price', when: 'Every day around 9:00 AM', trigger: 'cron', enabled: true, nextRunAt: Date.now() + 5 * HOUR, lastRunAt: Date.now() - 19 * HOUR, lastStatus: 'ok', runs: 12 },
    ],
    todos: [],
    tools: [],
    feed: [say({ id: 'b1', ago: 19 * HOUR, text: 'Still €439 for the 128 GB in good condition. No drop today, staying quiet.' })],
    script: [
      { s: 0, live: { running: true, activity: { kind: 'tool', tool: 'browser', detail: 'swappie.com/it/modello/iphone-15' } } },
      { s: 22, live: {} },
    ],
  },
  {
    bot: bot('00000000-0000-4000-8000-000000000003', 'QA Engineer', 'pebble', 'violet', 'Clicks through every new deploy and reports what breaks.'),
    automations: [{ id: 'q1', name: 'Smoke test after deploy', prompt: '', when: 'When a GitHub deploy finishes', trigger: 'github', enabled: true, nextRunAt: null, lastRunAt: Date.now() - 3 * HOUR, lastStatus: 'ok', runs: 31 }],
    todos: [
      { id: 't1', text: 'Open the new deploy', status: 'done' },
      { id: 't2', text: 'Sign up as a new user', status: 'doing' },
      { id: 't3', text: 'Check the billing page', status: 'todo' },
      { id: 't4', text: 'Write the report', status: 'todo' },
    ],
    tools: ['GitHub'],
    feed: [
      say({ id: 'c1', ago: 3 * HOUR, kind: 'tool', text: 'GitHub: list_deployments' }),
      say({ id: 'c2', ago: 2 * MIN, text: 'Sign-up works. The **billing page** shows a 500 when the card is declined, writing it up now.' }),
    ],
    script: [
      { s: 0, live: { running: true, activity: { kind: 'tool', tool: 'browser', detail: 'checkout on staging' } } },
      { s: 14, live: { running: true, activity: { kind: 'tool', tool: 'shell', detail: 'npm run test:e2e' } } },
      { s: 30, live: { running: true, activity: { kind: 'thinking', tool: null, detail: null } } },
      { s: 40, live: { running: true, activity: { kind: 'tool', tool: 'browser', detail: 'billing page' } } },
    ],
  },
  {
    bot: bot('00000000-0000-4000-8000-000000000004', 'Phone Desk', 'hex', 'violet', 'Makes calls and answers texts.'),
    automations: [],
    todos: [],
    tools: [],
    feed: [say({ id: 'd1', ago: 26 * HOUR, text: 'Called the dentist: moved to Tuesday 10:30. They will text a reminder the day before.' })],
    script: [
      { s: 0, live: {} },
      { s: 30, live: { running: true, activity: { kind: 'tool', tool: 'phone call', detail: 'calling +39 06 …' } } },
      { s: 55, live: {} },
    ],
  },
  {
    bot: bot('00000000-0000-4000-8000-000000000005', 'Social Studio', 'wedge', 'green', 'Writes and schedules posts on X.'),
    automations: [{ id: 's1', name: 'Morning post', prompt: '', when: 'Weekdays around 8:30 AM', trigger: 'cron', enabled: true, nextRunAt: Date.now() + 14 * HOUR, lastRunAt: Date.now() - 10 * HOUR, lastStatus: 'ok', runs: 40 }],
    todos: [
      { id: 'u1', text: 'Draft launch thread', status: 'done' },
      { id: 'u2', text: 'Make the demo GIF', status: 'todo' },
    ],
    tools: ['X'],
    feed: [
      say({ id: 'e1', ago: 10 * HOUR, kind: 'tool', text: 'X: create_post' }),
      say({ id: 'e2', ago: 10 * HOUR, text: 'Posted the morning update. 41 likes so far, the GIF did well.' }),
      {
        ...say({ id: 'e3', ago: 1 * MIN, kind: 'card', text: 'Post the launch thread now, or wait for the 8:30 slot?' }),
        card: {
          type: 'choice',
          entryId: 'e3',
          prompt: 'Post the launch thread now, or wait for the 8:30 slot?',
          multi: false,
          options: [
            { label: 'Post now', value: 'now', description: null },
            { label: 'Wait for 8:30', value: 'later', description: null },
          ],
        },
      },
    ],
    script: [
      { s: 0, live: { awaiting: 'your answer' } },
      { s: 40, live: {} },
    ],
  },
  {
    bot: bot('00000000-0000-4000-8000-000000000006', 'Link Librarian', 'clover', 'orange', 'Finds backlinks and directories to submit to.'),
    automations: [],
    todos: [],
    tools: [],
    feed: [say({ id: 'f1', ago: 5 * HOUR, text: 'Found 69 directories that accept dev tools. 12 are free and do-follow, list attached.' })],
    script: [{ s: 0, live: {} }],
  },
  {
    bot: bot('00000000-0000-4000-8000-000000000007', 'Repo Gardener', 'capsule', 'gray', 'Keeps the repos tidy: deps, CI, issues.'),
    automations: [{ id: 'g1', name: 'Weekly dependency bump', prompt: '', when: 'Every Monday around 7:00 AM', trigger: 'cron', enabled: true, nextRunAt: Date.now() + 3 * 24 * HOUR, lastRunAt: Date.now() - 4 * 24 * HOUR, lastStatus: 'ok', runs: 9 }],
    todos: [],
    tools: ['GitHub'],
    feed: [say({ id: 'g2', ago: 4 * 24 * HOUR, text: 'Bumped 14 packages, CI is green. One major (vite 8) left for you to review.' })],
    script: [
      { s: 0, live: {} },
      { s: 18, live: { running: true, activity: { kind: 'tool', tool: 'shell', detail: 'pnpm update -r' } } },
      { s: 44, live: {} },
    ],
  },
  {
    bot: bot('00000000-0000-4000-8000-000000000008', 'Trip Planner', 'cloud', 'blue', 'Plans trips and books trains.'),
    automations: [],
    todos: [],
    tools: [],
    feed: [say({ id: 'h1', ago: 3 * 24 * HOUR, text: 'Rome to Milan on the 9:10 Frecciarossa, €29. Want me to book it?' })],
    seen: true,
    script: [{ s: 0, live: {} }],
  },
  {
    bot: bot('00000000-0000-4000-8000-000000000009', 'Recipe Bot', 'egg', 'orange', null),
    automations: [],
    todos: [],
    tools: [],
    feed: [say({ id: 'i1', ago: 30 * HOUR, text: 'Tonight: lemon risotto, 25 minutes. You already have everything but parmesan.' })],
    seen: true,
    script: [{ s: 0, live: {} }],
  },
]

const LOOP_S = 70

// Each bot's script step at time `now`, as the live and read events the stream would send.
export function demoEvents(now: number): WatchEvent[] {
  const s = (now / 1000) % LOOP_S
  return BOTS.flatMap((b): WatchEvent[] => {
    const step = [...b.script].reverse().find((x) => x.s <= s) ?? b.script[0]
    // A bot that just stopped stays up a while; one that never ran in the loop sleeps.
    const ranBefore = b.script.some((x) => x.s < step.s && (x.live.running || x.live.awaiting))
    const lastActivityAt = step.live.running || step.live.awaiting ? now : ranBefore ? now - (s - step.s) * 1000 : now - 10 * MIN
    return [
      { type: 'live', botId: b.bot.id, live: live({ ...step.live, at: now }) },
      { type: 'read', botId: b.bot.id, read: readState({ b, now, lastActivityAt }) },
    ]
  })
}

// The demo's own read state, like the server's: marking a bot read here sticks.
const loadedAt = Date.now()
const viewed = new Map<string, number>()
export function demoMarkRead({ botId, at }: { botId: string; at: number }) {
  viewed.set(botId, at)
}
function readState({ b, now, lastActivityAt }: { b: DemoBot; now: number; lastActivityAt: number }): ReadState {
  const lastViewedAt = viewed.get(b.bot.id) ?? (b.seen ? loadedAt : null)
  return { at: now, lastViewedAt, lastActivityAt, lastEntryId: b.feed.at(-1)?.id ?? null, unread: lastViewedAt ? 0 : 1 }
}

export function demoOffice(now: number): OfficeSnapshot {
  const events = demoEvents(now)
  const of = <T extends WatchEvent['type']>(type: T, id: string) => events.find((e): e is Extract<WatchEvent, { type: T }> => e.type === type && 'botId' in e && e.botId === id)!
  return {
    email: null,
    at: now,
    bots: BOTS.map(({ script: _script, seen: _seen, ...b }) => ({
      ...b,
      live: of('live', b.bot.id).live,
      read: of('read', b.bot.id).read,
      cursor: { generation: 1, seq: Math.max(0, ...b.feed.map((item) => item.updated)) },
    })),
  }
}
