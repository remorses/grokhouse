// What each mascot does, frame by frame. The bot's live state picks a mood; the mood
// picks where to go and what to do there; walking is a chain of cartoon hops.
//
//   live.awaiting           ──▶ wait:  front of the room, waving, "?"
//   live.running + a tool   ──▶ work:  hop between work spots, the tool picks the spot
//   live.running            ──▶ think: pace with a thought bubble
//   active a moment ago     ──▶ idle:  potter about, then yawn and go to bed
//   otherwise               ──▶ sleep: in bed, breathing, Zzz
//
// Easing: each hop moves with ease-in-out (a jump, not a glide), squashes on take-off
// and landing, stretches in the air, and a damped spring wobbles the body on arrival.

import { clamp, lerp, streamOf, pk, type Rng } from '../engine/press.ts'
import { FACE_YAW, type Mark, type Pose } from '../engine/mascot.ts'
import { ROOM } from '../engine/world.ts'
import type { Act, RoomPlan, Spot } from '../layout.ts'
import type { Face } from '../types.ts'
import type { Presence } from '../state.ts'

export type Mood = 'sleep' | 'idle' | 'think' | 'work' | 'wait'

// After a run ends the bot stays up this long before it goes to bed.
const AWAKE_AFTER_MS = 90_000
const HOP_TILES = 0.42
const SPEED = { work: 2.6, think: 1.4, idle: 1.1, wait: 2.8, sleep: 1.7 }
const HOP_PX = { work: 12, think: 6, idle: 5, wait: 12, sleep: 8 }

type Task =
  | { kind: 'walk'; path: Array<[number, number]>; done: number; total: number; then: Task; windup: number }
  | { kind: 'do'; spot: Spot; until: number }
  | { kind: 'rest'; until: number }
  | { kind: 'bed' }
  | { kind: 'wake'; until: number; then: Task }

export type Actor = {
  id: string
  plan: RoomPlan
  // Room tile position (floats) and height above the floor in tiles.
  i: number
  j: number
  z: number
  face: Face
  // The body's turn, easing toward the face (and toward the camera while it peeks).
  yaw: number
  mood: Mood
  task: Task
  // Spring for squash: x > 0 squashes, x < 0 stretches.
  sq: { x: number; v: number }
  hop: number
  // performance.now() of the last landing, for the dust puffs.
  landed: number
  // Until when it looks at the camera instead of its work.
  peek: number
  walkPhase: number | null
  emote: { mark: Mark; until: number } | null
  tool: string | null
  R: Rng
}

export function createActor({ plan, live, now }: { plan: RoomPlan; live: Presence; now: number }): Actor {
  const mood = moodOf({ live, now, prev: null })
  const R = streamOf('actor', plan.botId)
  const start: Spot = mood === 'sleep' ? plan.bed : pk(R, plan.work)
  return {
    id: plan.botId,
    plan,
    i: start.i,
    j: start.j,
    z: mood === 'sleep' ? plan.bed.z ?? 0 : 0,
    face: start.face,
    yaw: FACE_YAW[start.face],
    mood,
    task: mood === 'sleep' ? { kind: 'bed' } : { kind: 'do', spot: start, until: 0 },
    sq: { x: 0, v: 0 },
    hop: 0,
    landed: 0,
    peek: 0,
    walkPhase: null,
    emote: null,
    tool: live.activity?.tool ?? null,
    R,
  }
}

export function moodOf({ live, now, prev }: { live: Presence; now: number; prev: Mood | null }): Mood {
  if (live.awaiting) return 'wait'
  if (live.running) return live.activity?.kind === 'tool' ? 'work' : 'think'
  const recent = live.lastActivityAt !== null && now - live.lastActivityAt < AWAKE_AFTER_MS
  if (recent || prev === 'work' || prev === 'think') return 'idle'
  return 'sleep'
}

// Which kind of spot a tool sends the bot to.
function actFor(tool: string | null): Act | null {
  if (!tool) return null
  if (/browser|web|search|fetch|navigate|open|read|screenshot|page/i.test(tool)) return 'browse'
  if (/shell|bash|terminal|exec|code|edit|write|file|python|run/i.test(tool)) return 'type'
  if (/phone|call|sms|whatsapp|voice|message|email|mail|send/i.test(tool)) return 'phone'
  if (/post|tweet|x\b|social|image|video|camera/i.test(tool)) return 'film'
  return null
}

// ---------------- paths ----------------
const tileOf = (v: number) => clamp(Math.floor(v), 0, ROOM - 1)

// Breadth-first search over free tiles, 8 ways (diagonals only past two free sides).
function findPath(plan: RoomPlan, from: [number, number], to: [number, number]): Array<[number, number]> {
  const [si, sj] = [tileOf(from[0]), tileOf(from[1])]
  const [ti, tj] = [tileOf(to[0]), tileOf(to[1])]
  const free = (i: number, j: number) => i >= 0 && j >= 0 && i < ROOM && j < ROOM && (plan.free[i][j] || (i === ti && j === tj) || (i === si && j === sj))
  const prev = new Map<number, number>()
  const key = (i: number, j: number) => i * ROOM + j
  const queue: Array<[number, number]> = [[si, sj]]
  prev.set(key(si, sj), -1)
  while (queue.length) {
    const [i, j] = queue.shift()!
    if (i === ti && j === tj) break
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const ni = i + di
      const nj = j + dj
      if (!free(ni, nj) || prev.has(key(ni, nj))) continue
      if (di && dj && (!free(i + di, j) || !free(i, j + dj))) continue
      prev.set(key(ni, nj), key(i, j))
      queue.push([ni, nj])
    }
  }
  if (!prev.has(key(ti, tj))) return [from, to]
  const tiles: Array<[number, number]> = []
  for (let k = key(ti, tj); k !== -1; k = prev.get(k)!) tiles.unshift([Math.floor(k / ROOM) + 0.5, (k % ROOM) + 0.5])
  // Start where the bot stands and end on the exact spot.
  tiles[0] = from
  tiles[tiles.length - 1] = to
  return tiles
}

const lengthOf = (path: Array<[number, number]>) => path.slice(1).reduce((sum, p, n) => sum + Math.hypot(p[0] - path[n][0], p[1] - path[n][1]), 0)

function pointAt(path: Array<[number, number]>, d: number): { i: number; j: number; di: number; dj: number } {
  for (let n = 1; n < path.length; n++) {
    const a = path[n - 1]
    const b = path[n]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (d <= len || n === path.length - 1) {
      const u = len ? clamp(d / len, 0, 1) : 1
      return { i: lerp(a[0], b[0], u), j: lerp(a[1], b[1], u), di: b[0] - a[0], dj: b[1] - a[1] }
    }
    d -= len
  }
  const last = path[path.length - 1]
  return { i: last[0], j: last[1], di: 0, dj: 0 }
}

export function faceOf(di: number, dj: number, fallback: Face): Face {
  if (Math.abs(di) < 1e-3 && Math.abs(dj) < 1e-3) return fallback
  if (Math.abs(di) >= Math.abs(dj)) return di > 0 ? 'se' : 'nw'
  return dj > 0 ? 'sw' : 'ne'
}

const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2)

function walkTo(a: Actor, to: Spot, then: Task): Task {
  const path = findPath(a.plan, [a.i, a.j], [to.i, to.j])
  const total = lengthOf(path)
  // Already there: no walk, so no zero-length hop (it would divide by zero).
  if (total < 1e-3) return then
  return { kind: 'walk', path, done: 0, total, then, windup: 0.16 }
}

function wanderSpot(a: Actor): Spot {
  for (let n = 0; n < 20; n++) {
    const i = 1 + Math.floor(a.R() * 7)
    const j = 1 + Math.floor(a.R() * 6)
    if (a.plan.free[i][j]) return { i: i + 0.5, j: j + 0.5, face: pk(a.R, ['se', 'sw'] as Face[]), act: 'think' }
  }
  return { i: 4.5, j: 4.5, face: 'se', act: 'think' }
}

// The next thing to do in this mood, from where the bot stands.
function plan(a: Actor, now: number): Task {
  if (a.mood === 'sleep') return walkTo(a, a.plan.bed, { kind: 'bed' })
  if (a.mood === 'wait') return walkTo(a, { i: 5.2, j: 4.6, face: 'se', act: 'think' }, { kind: 'do', spot: { i: 5.2, j: 4.6, face: 'se', act: 'think' }, until: now + 6000 })
  if (a.mood === 'idle') {
    const spot = a.R() < 0.45 ? pk(a.R, a.plan.work) : wanderSpot(a)
    return walkTo(a, spot, { kind: 'do', spot: { ...spot, act: 'think' }, until: now + 2500 + a.R() * 4000 })
  }
  const wanted = a.mood === 'work' ? actFor(a.tool) : null
  const away = (spots: Spot[]) => spots.filter((spot) => Math.hypot(spot.i - a.i, spot.j - a.j) > 0.6)
  const fitting = away(wanted ? a.plan.work.filter((spot) => spot.act === wanted) : [])
  // The tool's own spot when there is one, else anywhere else: busy bots keep moving.
  const pool = fitting.length ? fitting : away(a.plan.work).length ? away(a.plan.work) : a.plan.work
  const spot = a.mood === 'think' && a.R() < 0.5 ? wanderSpot(a) : pk(a.R, pool)
  return walkTo(a, spot, { kind: 'do', spot, until: now + 2600 + a.R() * 3200 })
}

// Called on every live update: a new mood or tool may change the plan right away.
// `now` is performance.now(), the clock of tasks and emotes; moods use wall time.
export function setLive(a: Actor, live: Presence, now: number) {
  const mood = moodOf({ live, now: Date.now(), prev: a.mood })
  const tool = live.activity?.tool ?? null
  const before = a.mood
  const toolChanged = tool !== a.tool
  a.tool = tool
  if (mood === before) {
    // A new tool shows as a quick "!"; step() walks to the spot that fits it.
    if (mood === 'work' && toolChanged) a.emote = { mark: '!', until: now + 700 }
    return
  }
  a.mood = mood
  if (before === 'sleep' && mood !== 'sleep') {
    // Woken up: a startled jump out of bed, then off to work.
    a.emote = { mark: '!', until: now + 1400 }
    kick(a, -0.35)
    a.task = { kind: 'wake', until: now + 900, then: { kind: 'rest', until: 0 } }
    return
  }
  if (mood === 'wait') a.emote = { mark: '?', until: now + 4000 }
  if (mood === 'idle' && (before === 'work' || before === 'think')) {
    // A run just ended: a little victory hop.
    a.emote = { mark: 'sparkle', until: now + 2200 }
    kick(a, -0.3)
  }
  if (mood === 'work' && before !== 'work') a.emote = { mark: '!', until: now + 1000 }
  if (a.task.kind !== 'walk') a.task = { kind: 'rest', until: 0 }
}

// Poked by a click: sleeping bots jump awake for a moment, others hop and blush.
export function poke(a: Actor, now: number) {
  kick(a, -0.4)
  if (a.mood === 'sleep') {
    a.emote = { mark: '!', until: now + 1500 }
    a.task = { kind: 'wake', until: now + 2600, then: { kind: 'bed' } }
    return
  }
  a.emote = { mark: 'heart', until: now + 1800 }
}

function kick(a: Actor, v: number) {
  a.sq.v += v * 8
}

export function step(a: Actor, dt: number, now: number) {
  // The squash spring: stiff and lightly damped, so it overshoots once or twice.
  const K = 260
  const C = 14
  a.sq.v += (-K * a.sq.x - C * a.sq.v) * dt
  a.sq.x = clamp(a.sq.x + a.sq.v * dt, -0.35, 0.35)
  if (a.emote && a.emote.until < now) a.emote = null
  // Turn the short way round, quickly: a spin you can see, not a flip.
  const want = a.peek > now && a.task.kind === 'do' ? 0 : FACE_YAW[a.face]
  a.yaw += Math.atan2(Math.sin(want - a.yaw), Math.cos(want - a.yaw)) * Math.min(1, dt * 12)
  a.walkPhase = null
  a.hop = 0

  const task = a.task
  if (task.kind === 'walk') {
    if (task.windup > 0) {
      // Anticipation: crouch before the first hop.
      task.windup -= dt
      a.sq.x = lerp(a.sq.x, 0.2, 0.3)
      if (a.z > 0) a.z = Math.max(0, a.z - dt * 1.5)
      return
    }
    const speed = SPEED[a.mood]
    task.done = Math.min(task.total, task.done + speed * dt)
    const hops = Math.max(1, Math.round(task.total / HOP_TILES))
    const hopLen = task.total / hops
    const before = Math.floor((task.done - speed * dt) / hopLen)
    const k = Math.min(hops - 1, Math.floor(task.done / hopLen))
    const u = clamp(task.done / hopLen - k, 0, 1)
    if (k !== before && a.mood !== 'idle') a.landed = now
    const shown = Math.min(task.total, (k + easeInOut(u)) * hopLen)
    const p = pointAt(task.path, shown)
    a.i = p.i
    a.j = p.j
    const face = faceOf(p.di, p.dj, a.face)
    // Turning is a little pop, not a flip.
    if (face !== a.face) kick(a, 0.3)
    a.face = face
    a.hop = Math.sin(u * Math.PI) * HOP_PX[a.mood]
    a.walkPhase = u
    // Squash at both ends of each hop, stretch in the middle.
    a.sq.x = lerp(a.sq.x, u < 0.14 || u > 0.86 ? 0.26 : -0.17, 0.4)
    if (task.done >= task.total - 1e-4) {
      a.sq.v += 2.6 // landing wobble
      a.landed = now
      a.task = task.then
      if (task.then.kind === 'do') a.face = task.then.spot.face
    }
    return
  }
  if (task.kind === 'wake') {
    a.z = Math.max(0, a.z - dt)
    a.hop = Math.max(0, Math.sin(((task.until - now) / 900) * Math.PI)) * 16
    if (now > task.until) a.task = task.then
    return
  }
  if (task.kind === 'bed') {
    a.face = 'se'
    a.z = lerp(a.z, a.plan.bed.z ?? 0, 0.2)
    a.i = lerp(a.i, a.plan.bed.i, 0.2)
    a.j = lerp(a.j, a.plan.bed.j, 0.2)
    if (a.mood !== 'sleep') a.task = plan(a, now)
    return
  }
  if (task.kind === 'do' && now < task.until && task.until > 0) {
    // At work, now and then it turns round to peek at you, then back to the job.
    if (a.mood === 'work' && !a.peek && a.R() < dt * 0.35) {
      a.peek = now + 900
      kick(a, -0.25)
    }
    if (a.peek && now > a.peek) {
      a.peek = 0
      kick(a, 0.2)
    }
    // Pottering about: now and then a little hop and a turn the other way.
    if (a.mood === 'idle' && a.R() < dt * 0.4) {
      a.face = a.face === 'se' ? 'sw' : 'se'
      kick(a, -0.25)
    }
    if (a.mood === 'work' && actFor(a.tool) && actFor(a.tool) !== task.spot.act && a.plan.work.some((s) => s.act === actFor(a.tool))) a.task = plan(a, now)
    if (a.mood === 'sleep') a.task = plan(a, now)
    return
  }
  a.task = plan(a, now)
}

// The pose for this frame: what the mood, the task and the spring look like.
export function poseOf(a: Actor, t: number, now: number): Pose {
  const sleeping = a.task.kind === 'bed' && a.mood === 'sleep'
  const doing = a.task.kind === 'do' ? a.task.spot.act : null
  const working = a.mood === 'work' || a.mood === 'think'
  const breath = sleeping ? Math.sin(t * 1.6) * 0.05 : Math.sin(t * 3) * 0.015
  const sq = a.sq.x + breath
  const peeking = a.peek > now && a.task.kind === 'do'
  const pose: Pose = {
    t,
    face: a.face,
    yaw: a.yaw,
    sx: 1 + sq * 0.8,
    sy: 1 - sq,
    lean: a.walkPhase !== null ? (a.face === 'se' || a.face === 'ne' ? 0.08 : -0.08) : 0,
    lift: a.hop + a.z * 32,
    eyes: 'open',
    mark: null,
    dust: now - a.landed < 350 ? (now - a.landed) / 350 : null,
  }
  if (sleeping) {
    pose.eyes = 'shut'
    pose.mark = 'z'
    pose.lying = true
  } else if (doing && working) {
    pose.eyes = doing === 'type' ? 'focus' : 'open'
    pose.mark = a.mood === 'think' ? 'dots' : doing === 'phone' ? 'note' : null
    // Each act has its own fidget: typing bobs fast, browsing sways, reading rocks, calls bounce.
    if (doing === 'type' || doing === 'plug') {
      pose.lift += Math.abs(Math.sin(t * 9)) * 3
      pose.sy *= 1 + Math.sin(t * 18) * 0.05
    }
    if (doing === 'browse') pose.lean = Math.sin(t * 2.2) * 0.14
    if (doing === 'read' || doing === 'think') pose.lean = Math.sin(t * 1.3) * 0.08
    if (doing === 'phone' || doing === 'sip') pose.lift += Math.abs(Math.sin(t * 4.5)) * 4
    if (doing === 'film') pose.lift += Math.abs(Math.sin(t * 6)) * 5
  } else if (a.mood === 'wait') {
    pose.eyes = 'wide'
    pose.mark = '?'
    pose.lift += Math.abs(Math.sin(t * 5)) * 6
  } else if (a.mood === 'think') pose.mark = 'dots'
  else if (a.mood === 'idle' && a.task.kind === 'do') {
    // Pottering: look about, sometimes hum.
    pose.mark = Math.sin(t * 0.7 + a.i) > 0.6 ? 'note' : null
    pose.eyes = Math.sin(t * 0.5 + a.j) > 0.85 ? 'happy' : 'open'
  }
  if (peeking) {
    pose.eyes = 'happy'
    pose.mark = null
  }
  if (a.task.kind === 'wake') {
    pose.eyes = 'wide'
  }
  if (a.emote) {
    pose.mark = a.emote.mark
    if (a.emote.mark === 'sparkle' || a.emote.mark === 'heart') {
      pose.eyes = 'happy'
    }
  }
  return pose
}
