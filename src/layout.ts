// One room per bot. The room's furniture comes from what the bot is for: a price
// watcher keeps a shop, a QA bot a test lab, a caller a switchboard. Words in its name,
// description, schedules and the apps it used pick the theme; the seed (bot ID) picks
// the colours. Schedules hang a calendar and set the wall clock to the next run; the
// bot's todo list is sticky notes on a corkboard.
//
// Room space: 9×9 tiles, i runs down-right, j down-left. The back walls are j = 0 ('ne')
// and i = 0 ('nw'); the front is open. Every room also gets a bed, where a bot sleeps.

import { pk, streamOf } from './engine/press.ts'
import { footprint, kindOf, type Kind } from './engine/kinds.ts'
import { ROOM } from './engine/world.ts'
import type { At, Face, Item, Room } from './types.ts'
import type { BotSnapshot } from '../worker/protocol.ts'

export type Act = 'type' | 'browse' | 'read' | 'phone' | 'plug' | 'sip' | 'film' | 'think'
export type Spot = { i: number; j: number; face: Face; act: Act; z?: number }
export type Theme = 'lobby' | 'shop' | 'lab' | 'calls' | 'studio' | 'library' | 'dev' | 'den'

export type RoomPlan = {
  botId: string
  theme: Theme
  room: Room
  items: Item[]
  bed: Spot
  work: Spot[]
  // Tiles nothing stands on: where a bot may walk.
  free: boolean[][]
}

type Put = { kind: string; at: At; colors?: Record<string, string>; options?: Record<string, string | number> }
type ThemeDef = { walls: Room['walls']; floor: Room['floor']; rug: string; things: Put[]; work: Spot[] }

const THEMES: Array<{ theme: Theme; words: RegExp }> = [
  { theme: 'lobby', words: /primary|route|router|main bot|grok bot|assistant|inbox|reception/i },
  { theme: 'shop', words: /price|deal|shop|buy|ebay|subito|swappie|amazon|store|discount|watch|cheap|€|\$/i },
  { theme: 'lab', words: /\bqa\b|test|tester|bug|deploy|smoke|check|iphone|device/i },
  { theme: 'calls', words: /call|caller|phone|voice|sms|inkbox|whatsapp|telegram/i },
  { theme: 'studio', words: /marketing|tweet|twitter|\bx\b|social|content|post|follower|tiktok|instagram|youtube|reddit|ghosthand/i },
  { theme: 'library', words: /backlink|seo|link|research|read|docs|writer|blog|article|directory/i },
  { theme: 'dev', words: /code|opencode|github|\bdev|build|program|repo|engineer|deps|\bci\b/i },
]

export function themeOf(snapshot: BotSnapshot): Theme {
  // The name speaks loudest, then what it was made for, then what it actually did.
  const sources = [
    snapshot.bot.name,
    snapshot.bot.description ?? '',
    snapshot.automations.map((a) => `${a.name} ${a.prompt}`).join(' '),
    snapshot.tools.join(' '),
  ]
  for (const text of sources) for (const { theme, words } of THEMES) if (words.test(text)) return theme
  return 'den'
}

const desk = (at: At, top = 'oak'): Put => ({ kind: 'desk', at, colors: { top, legs: 'black', drawers: 'white' } })
const on = (kind: string, at: At, colors?: Record<string, string>): Put => ({ kind, at, colors })

function themeDef(theme: Theme, R: () => number): ThemeDef {
  const accent = pk(R, ['coral', 'teal', 'mustard', 'sage', 'pink', 'sky'])
  if (theme === 'lobby')
    return {
      walls: { ink: 'coral', tone: 0.2, style: 'stripe', ink2: 'sun' },
      floor: { style: 'checker', ink: 'sun', tone: 0.18, ink2: 'coral', tone2: 0.2 },
      rug: 'terracotta',
      things: [
        desk({ i: 1.2, j: 0, face: 'ne' }, 'walnut'),
        on('monitor', { i: 1.4, j: 0.1, z: 0.86, face: 'ne' }),
        on('rotary-phone', { i: 2.6, j: 0.5, z: 0.86, face: 'ne' }),
        { kind: 'switchboard', at: { i: 0, j: 3.4, face: 'nw' } },
        { kind: 'mail-cubbies', at: { i: 4.2, j: 0, z: 1.2, face: 'ne' } },
        { kind: 'big-plant', at: { i: 0.1, j: 0.1, face: 'ne' }, options: { style: 'palm' } },
        { kind: 'armchair', at: { i: 3.4, j: 6.2, face: 'ne' }, colors: { body: accent, legs: 'walnut' } },
        { kind: 'side-table', at: { i: 4.8, j: 6.4, face: 'ne' } },
        on('globe', { i: 4.95, j: 6.55, z: 0.63, face: 'ne' }),
      ],
      work: [
        { i: 2.2, j: 1.6, face: 'ne', act: 'type' },
        { i: 1.3, j: 4.1, face: 'nw', act: 'plug' },
        { i: 5.0, j: 1.0, face: 'ne', act: 'read' },
      ],
    }
  if (theme === 'shop')
    return {
      walls: { ink: 'sun', tone: 0.3, style: 'plank' },
      floor: { style: 'tiles', ink: 'sun', tone: 0.16, ink2: 'coral' },
      rug: 'red',
      things: [
        { kind: 'kitchen-counter', at: { i: 0, j: 3.3, face: 'nw' }, colors: { cabinet: accent, top: 'white', knobs: 'brass' } },
        on('cash-register', { i: 0.2, j: 3.6, z: 0.96, face: 'nw' }),
        on('iced-coffee', { i: 0.4, j: 4.8, z: 0.96, face: 'nw' }),
        { kind: 'shop-shelf', at: { i: 0.7, j: 0, face: 'ne' } },
        { kind: 'shop-shelf', at: { i: 2.7, j: 0, face: 'ne' }, colors: { g1: 'teal', g2: 'pink', g3: 'sky', g4: 'yellow', g5: 'coral' } },
        { kind: 'chalkboard', at: { i: 4.8, j: 0, z: 1.15, face: 'ne' } },
        { kind: 'cardboard-box', at: { i: 3.6, j: 6.6, face: 'ne' } },
        { kind: 'cardboard-box', at: { i: 4.5, j: 6.9, face: 'ne' } },
        { kind: 'snake-plant', at: { i: 0.1, j: 0.1, face: 'ne' } },
      ],
      work: [
        { i: 1.5, j: 4.3, face: 'nw', act: 'type' },
        { i: 1.6, j: 1.3, face: 'ne', act: 'browse' },
        { i: 3.6, j: 1.3, face: 'ne', act: 'browse' },
        { i: 5.6, j: 1.0, face: 'ne', act: 'read' },
      ],
    }
  if (theme === 'lab')
    return {
      walls: { ink: 'teal', tone: 0.16, style: 'tile' },
      floor: { style: 'tiles', ink: 'blue', tone: 0.08 },
      rug: 'sky',
      things: [
        desk({ i: 0.7, j: 0, face: 'ne' }, 'white'),
        on('monitor', { i: 0.9, j: 0.1, z: 0.86, face: 'ne' }),
        on('rubber-duck', { i: 2.2, j: 0.5, z: 0.86, face: 'ne' }),
        desk({ i: 0, j: 3.3, face: 'nw' }, 'white'),
        on('laptop', { i: 0.2, j: 3.6, z: 0.86, face: 'nw' }),
        on('phone', { i: 0.35, j: 4.6, z: 0.86, face: 'nw' }),
        { kind: 'whiteboard', at: { i: 3.0, j: 0, z: 1.0, face: 'ne' } },
        { kind: 'server-tower', at: { i: 5.2, j: 0, face: 'ne' } },
        { kind: 'water-cooler', at: { i: 0, j: 5.8, face: 'nw' } },
      ],
      work: [
        { i: 1.7, j: 1.6, face: 'ne', act: 'type' },
        { i: 1.6, j: 4.3, face: 'nw', act: 'phone' },
        { i: 4.0, j: 1.0, face: 'ne', act: 'read' },
        { i: 5.6, j: 1.4, face: 'ne', act: 'plug' },
      ],
    }
  if (theme === 'calls')
    return {
      walls: { ink: 'coral', tone: 0.28, style: 'dots', ink2: 'sun' },
      floor: { style: 'carpet', ink: 'coral', tone: 0.18, ink2: 'blue' },
      rug: 'mustard',
      things: [
        desk({ i: 0.8, j: 0, face: 'ne' }, 'oak'),
        on('rotary-phone', { i: 1.1, j: 0.45, z: 0.86, face: 'ne' }),
        on('laptop', { i: 1.9, j: 0.3, z: 0.86, face: 'ne' }),
        { kind: 'switchboard', at: { i: 3.4, j: 0, face: 'ne' } },
        { kind: 'filing-cabinet', at: { i: 0, j: 3.3, face: 'nw' } },
        on('table-lamp', { i: 0.1, j: 3.5, z: 1.35, face: 'nw' }),
        { kind: 'water-cooler', at: { i: 0, j: 4.4, face: 'nw' } },
        { kind: 'armchair', at: { i: 3.2, j: 6.3, face: 'ne' }, colors: { body: accent, legs: 'walnut' } },
        { kind: 'big-plant', at: { i: 0.1, j: 0.1, face: 'ne' } },
      ],
      work: [
        { i: 1.8, j: 1.6, face: 'ne', act: 'phone' },
        { i: 4.1, j: 1.3, face: 'ne', act: 'plug' },
        { i: 1.3, j: 3.6, face: 'nw', act: 'browse' },
        { i: 1.2, j: 4.7, face: 'nw', act: 'sip' },
      ],
    }
  if (theme === 'studio')
    return {
      walls: { ink: 'coral', tone: 0.18, style: 'plain' },
      floor: { style: 'planks', ink: 'coral', tone: 0.22 },
      rug: 'yellow',
      things: [
        desk({ i: 0.6, j: 0, face: 'ne' }, 'white'),
        on('laptop', { i: 0.8, j: 0.3, z: 0.86, face: 'ne' }),
        on('microphone', { i: 1.9, j: 0.4, z: 0.86, face: 'ne' }),
        { kind: 'ring-light', at: { i: 3.0, j: 0.2, face: 'ne' } },
        { kind: 'camera-tripod', at: { i: 3.4, j: 3.4, face: 'ne' } },
        { kind: 'sofa', at: { i: 0, j: 3.2, face: 'nw' }, colors: { body: accent, cushion: accent, legs: 'walnut' } },
        { kind: 'poster', at: { i: 4.4, j: 0, z: 1.2, face: 'ne' } },
        { kind: 'poster', at: { i: 0, j: 1.1, z: 1.25, face: 'nw' }, colors: { frame: 'black', paper: 'cream' } },
        { kind: 'snake-plant', at: { i: 5.6, j: 0.1, face: 'ne' } },
      ],
      work: [
        { i: 1.6, j: 1.6, face: 'ne', act: 'type' },
        { i: 3.35, j: 1.2, face: 'sw', act: 'film' },
        { i: 1.9, j: 4.7, face: 'nw', act: 'browse' },
      ],
    }
  if (theme === 'library')
    return {
      walls: { ink: 'teal', tone: 0.24, style: 'plank' },
      floor: { style: 'planks', ink: 'sun', tone: 0.4 },
      rug: 'plum',
      things: [
        { kind: 'bookshelf', at: { i: 0.5, j: 0, face: 'ne' } },
        { kind: 'bookshelf', at: { i: 2.2, j: 0, face: 'ne' }, colors: { wood: 'walnut' } },
        { kind: 'filing-cabinet', at: { i: 4.0, j: 0, face: 'ne' }, colors: { body: 'mustard' } },
        on('globe', { i: 4.12, j: 0.15, z: 1.35, face: 'ne' }),
        desk({ i: 0, j: 3.3, face: 'nw' }, 'walnut'),
        on('laptop', { i: 0.2, j: 3.6, z: 0.86, face: 'nw' }),
        on('table-lamp', { i: 0.25, j: 4.75, z: 0.86, face: 'nw' }),
        { kind: 'armchair', at: { i: 3.0, j: 6.3, face: 'ne' }, colors: { body: accent, legs: 'walnut' } },
        { kind: 'floor-lamp', at: { i: 4.3, j: 6.6, face: 'ne' } },
      ],
      work: [
        { i: 1.3, j: 1.2, face: 'ne', act: 'browse' },
        { i: 3.0, j: 1.2, face: 'ne', act: 'browse' },
        { i: 1.6, j: 4.3, face: 'nw', act: 'type' },
        { i: 4.3, j: 1.4, face: 'ne', act: 'read' },
      ],
    }
  if (theme === 'dev')
    return {
      walls: { ink: 'blue', tone: 0.18, style: 'brick' },
      floor: { style: 'concrete', ink: 'blue', tone: 0.12 },
      rug: 'teal',
      things: [
        desk({ i: 0.6, j: 0, face: 'ne' }, 'walnut'),
        on('monitor', { i: 0.75, j: 0.1, z: 0.86, face: 'ne' }),
        on('desktop-computer', { i: 1.95, j: 0.55, z: 0.86, face: 'ne' }),
        on('rubber-duck', { i: 2.3, j: 0.35, z: 0.86, face: 'ne' }),
        { kind: 'server-tower', at: { i: 3.0, j: 0, face: 'ne' } },
        { kind: 'whiteboard', at: { i: 4.1, j: 0, z: 1.0, face: 'ne' } },
        { kind: 'bean-bag', at: { i: 3.0, j: 6.2, face: 'ne' }, colors: { bag: accent } },
        { kind: 'arcade-cabinet', at: { i: 0, j: 3.3, face: 'nw' } },
        { kind: 'snake-plant', at: { i: 0, j: 4.3, face: 'nw' } },
      ],
      work: [
        { i: 1.6, j: 1.6, face: 'ne', act: 'type' },
        { i: 3.4, j: 1.3, face: 'ne', act: 'plug' },
        { i: 4.9, j: 1.0, face: 'ne', act: 'read' },
        { i: 1.3, j: 3.6, face: 'nw', act: 'think' },
      ],
    }
  return {
    walls: { ink: 'sun', tone: 0.22, style: 'plain' },
    floor: { style: 'planks', ink: 'sun', tone: 0.34 },
    rug: accent,
    things: [
      desk({ i: 0.6, j: 0, face: 'ne' }),
      on('laptop', { i: 0.8, j: 0.3, z: 0.86, face: 'ne' }),
      on('table-lamp', { i: 2.1, j: 0.3, z: 0.86, face: 'ne' }),
      { kind: 'bookshelf', at: { i: 0, j: 3.3, face: 'nw' } },
      { kind: 'dresser', at: { i: 3.2, j: 0, face: 'ne' } },
      on('record-player', { i: 3.4, j: 0.05, z: 1, face: 'ne' }),
      { kind: 'armchair', at: { i: 3.2, j: 6.3, face: 'ne' }, colors: { body: accent, legs: 'walnut' } },
      { kind: 'bench-plant', at: { i: 0, j: 5.2, face: 'nw' } },
    ],
    work: [
      { i: 1.6, j: 1.6, face: 'ne', act: 'type' },
      { i: 1.3, j: 4.1, face: 'nw', act: 'browse' },
      { i: 3.9, j: 1.2, face: 'ne', act: 'think' },
    ],
  }
}

const NOTE_COLORS: Record<string, string> = { todo: 'yellow', doing: 'pink', done: 'mint', cancelled: 'silver' }
const MAX_NOTES = 8

export function planRoom({ snapshot, at, kinds }: { snapshot: BotSnapshot; at: [number, number]; kinds: Record<string, Kind> }): RoomPlan {
  const { bot } = snapshot
  const R = streamOf('room', bot.id)
  const theme = themeOf(snapshot)
  const def = themeDef(theme, R)
  const room: Room = {
    id: bot.id,
    type: theme,
    name: bot.name,
    at,
    w: ROOM,
    d: ROOM,
    walls: def.walls,
    floor: def.floor,
    windows: [{ side: 'nw', pos: 7.4, w: 1.6, h: 1.2, z: 1.0 }],
    bulb: { side: 'ne', pos: 7.6 },
  }
  const puts: Put[] = [
    { kind: 'rug', at: { i: 2.6, j: 2.5, face: 'ne' }, colors: { rug: def.rug, pattern: 'cream' } },
    ...def.things,
    { kind: 'bot-bed', at: { i: 6.5, j: 5.9, face: 'ne' }, colors: { base: pk(R, ['terracotta', 'teal', 'mustard', 'plum', 'coral']), blanket: pk(R, ['sky', 'pink', 'mint', 'yellow']) } },
  ]

  // The wall clock points at the next scheduled run; the calendar says "this bot has a schedule".
  const next = snapshot.automations.filter((a) => a.enabled && a.nextRunAt).sort((a, b) => a.nextRunAt! - b.nextRunAt!)[0]
  const when = next?.nextRunAt ? new Date(next.nextRunAt) : null
  puts.push({ kind: 'clock', at: { i: 0, j: 1.1, z: 1.75, face: 'nw' }, options: when ? { hour: when.getHours(), minute: when.getMinutes() } : {} })
  if (snapshot.automations.length) puts.push({ kind: 'calendar', at: { i: 0, j: 2.2, z: 1.3, face: 'nw' } })
  if (snapshot.automations.length) puts.push(on('alarm-clock', { i: 6.9, j: 5.75, z: 0, face: 'ne' }))

  // The todo list: one sticky note per item on a corkboard.
  const board = { i: 6.4, z: 1.15 }
  puts.push({ kind: 'corkboard', at: { i: board.i, j: 0, z: board.z, face: 'ne' } })
  snapshot.todos.slice(-MAX_NOTES).forEach((todo, n) => {
    const col = n % 4
    const row = Math.floor(n / 4)
    puts.push({ kind: 'sticky-note', at: { i: board.i + 0.14 + col * 0.37, j: 0, z: board.z + 0.6 - row * 0.42, face: 'ne' }, colors: { note: NOTE_COLORS[todo.status] } })
  })

  const items: Item[] = puts.map((put, n) => ({ id: `${bot.id}:${n}`, kind: put.kind, name: put.kind, room: bot.id, at: put.at, colors: put.colors, options: put.options }))
  for (const item of items) {
    const kind = kindOf(kinds, item)
    if (kind?.place === 'wall' && item.at.z === undefined) item.at.z = kind.z ?? 1.2
  }
  // Surface things (and the alarm clock on the floor by the bed) never block a tile.
  const free = Array.from({ length: ROOM }, () => Array.from({ length: ROOM }, () => true))
  for (const item of items) {
    const kind = kindOf(kinds, item)
    if (!kind || kind.place === 'surface') continue
    for (const [i, j] of footprint(kind, item)) if (i >= 0 && j >= 0 && i < ROOM && j < ROOM) free[i][j] = false
  }
  return {
    botId: bot.id,
    theme,
    room,
    items,
    bed: { i: 7.15, j: 6.55, face: 'se', act: 'think', z: 0.2 },
    work: def.work,
    free,
  }
}

// Rooms on a grid that reads as a diamond. The primary bot (the lobby) takes the top
// room; the rest keep the order the Grok Bot app lists them in.
export function orderBots(bots: BotSnapshot[]) {
  return [...bots].sort((a, b) => Number(themeOf(b) === 'lobby') - Number(themeOf(a) === 'lobby'))
}

export function planOffice({ bots, kinds }: { bots: BotSnapshot[]; kinds: Record<string, Kind> }) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(bots.length)))
  return orderBots(bots).map((snapshot, n) => planRoom({ snapshot, at: [n % cols, Math.floor(n / cols)], kinds }))
}
