// The camera and the canvas. Each room's base and each thing are printed once into a
// cache at whole device pixels per dot, then blitted at the zoom; the mascots are drawn
// live every frame, sorted in among the things of their room.

import { iso, mkHand, lerp, streamOf, clamp } from '../engine/press.ts'
import { WALL_H, roomBounds, roomOrigin } from '../engine/world.ts'
import { depthOf, drawThing, screenBox, type Kind } from '../engine/kinds.ts'
import { drawBase, layerOf } from '../engine/scene.ts'
import { drawMascot, BODY, type Look } from '../engine/mascot.ts'
import { createActor, poke, poseOf, setLive, step, type Actor } from './actors.ts'
import type { RoomPlan } from '../layout.ts'
import type { Item } from '../types.ts'
import type { Presence } from '../state.ts'

const ZOOMS = [0.3, 0.36, 0.42, 0.5, 0.56, 0.62, 0.7, 0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2, 2.5]
const MAX_RATIO = 3
const SCALE = 1.3 // how big a mascot stands in its room
const FOCUS_MS = 900

type RoomEntry = {
  plan: RoomPlan
  ox: number
  oy: number
  b: ReturnType<typeof roomBounds>
  ver: string
  base: { ratio: number; cv: HTMLCanvasElement } | null
}
type Sprite = { ratio: number; x0: number; y0: number; cv: HTMLCanvasElement }

export type Anchor = { x: number; y: number; visible: boolean }

export function createViewer({ view, stage, onPick }: { view: HTMLElement; stage: HTMLCanvasElement; onPick: (pick: { botId: string; bot: boolean } | null) => void }) {
  const ctx = stage.getContext('2d')!
  let kinds: Record<string, Kind> = {}
  const rooms = new Map<string, RoomEntry>()
  const actors = new Map<string, Actor>()
  const looks = new Map<string, Look>()
  const sprites = new Map<string, Sprite>()
  let dpr = 1
  let vw = 0
  let vh = 0
  let clock = 0
  let lastT = 0
  let raf = 0
  const cam = { x: 0, y: 0, z: 1 }
  let tween: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; t0: number; d: number } | null = null
  let userCam = false
  const frameListeners: Array<() => void> = []

  const ratioNow = () => {
    const z = cam.z * dpr
    return z <= 1 ? 1 : Math.min(MAX_RATIO, Math.ceil(z - 0.01))
  }
  const zr = () => cam.z * dpr
  const devX = (wx: number) => (wx - cam.x) * zr() + stage.width / 2
  const devY = (wy: number) => (wy - cam.y) * zr() + stage.height / 2
  const toWorld = (px: number, py: number): [number, number] => [(px * dpr - stage.width / 2) / zr() + cam.x, (py * dpr - stage.height / 2) / zr() + cam.y]

  function printed(w: number, h: number, ratio: number, x0: number, y0: number, draw: (c: CanvasRenderingContext2D) => void) {
    const cv = document.createElement('canvas')
    cv.width = Math.max(1, Math.ceil(w * ratio))
    cv.height = Math.max(1, Math.ceil(h * ratio))
    const c = cv.getContext('2d')!
    c.imageSmoothingEnabled = false
    c.setTransform(ratio, 0, 0, ratio, -x0 * ratio, -y0 * ratio)
    draw(c)
    return cv
  }

  function baseOf(R: RoomEntry) {
    const ratio = ratioNow()
    if (!R.base || R.base.ratio !== ratio) {
      const b = R.b
      R.base = { ratio, cv: printed(b.x1 - b.x0, b.y1 - b.y0, ratio, b.x0, b.y0, (c) => drawBase(mkHand(c, { seed: 1 }), R.plan.room, R.plan.items, kinds, {})) }
    }
    return R.base
  }

  function spriteOf(it: Item): Sprite {
    const ratio = ratioNow()
    const key = `${ratio}|${JSON.stringify(it)}`
    const have = sprites.get(key)
    if (have) return have
    const k = kinds[it.kind]
    const bx = screenBox(k, it)
    const s: Sprite = { ratio, x0: bx.x0, y0: bx.y0, cv: printed(bx.x1 - bx.x0, bx.y1 - bx.y0, ratio, bx.x0, bx.y0, (c) => drawThing(mkHand(c, { seed: 1 }), streamOf('item', it.id), k, it, {})) }
    sprites.set(key, s)
    return s
  }

  function worldBounds() {
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const R of rooms.values()) {
      x0 = Math.min(x0, R.ox + R.b.x0)
      y0 = Math.min(y0, R.oy + R.b.y0 - 40)
      x1 = Math.max(x1, R.ox + R.b.x1)
      y1 = Math.max(y1, R.oy + R.b.y1)
    }
    return { x0, y0, x1, y1 }
  }

  // Leaves room at the top for the header and at the bottom for the bot strip.
  function fitZoom(b: { x0: number; y0: number; x1: number; y1: number }) {
    const padX = vw < 700 ? 16 : 60
    const usableH = vh - (vw < 700 ? 190 : 210)
    const z = Math.min((vw - padX * 2) / (b.x1 - b.x0), usableH / (b.y1 - b.y0))
    return clamp(z, ZOOMS[0], 1.2)
  }

  function moveTo(to: { x: number; y: number; z: number }, animate: boolean) {
    if (!animate) {
      cam.x = to.x
      cam.y = to.y
      setZoom(to.z)
      tween = null
      return
    }
    tween = { x0: cam.x, y0: cam.y, z0: cam.z, x1: to.x, y1: to.y, z1: to.z, t0: clock, d: FOCUS_MS / 1000 }
  }

  function setZoom(z: number) {
    const before = ratioNow()
    cam.z = z
    if (ratioNow() !== before) forgetOtherSizes()
  }

  function forgetOtherSizes() {
    const r = ratioNow()
    for (const [id, sp] of sprites) if (sp.ratio !== r) sprites.delete(id)
    for (const R of rooms.values()) if (R.base && R.base.ratio !== r) R.base = null
  }

  function fit(animate: boolean) {
    if (!rooms.size) return
    const b = worldBounds()
    // The bot strip sits at the bottom: centre a bit lower than the middle.
    moveTo({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 + 30, z: fitZoom(b) }, animate)
  }

  function focus(botId: string) {
    const R = rooms.get(botId)
    if (!R) return
    userCam = true
    const z = clamp(Math.min(vw / 900, vh / 640) * 1.15, 0.7, 1.75)
    // Off-centre to the left so the details drawer on the right does not cover it.
    const shift = vw > 900 ? 190 / z : 0
    moveTo({ x: R.ox + (R.b.x0 + R.b.x1) / 2 + shift, y: R.oy + (R.b.y0 + R.b.y1) / 2 + 20, z }, true)
  }

  function zoomBy(stepBy: number, px?: number, py?: number) {
    const near = ZOOMS.reduce((best, z, n) => (Math.abs(z - cam.z) < Math.abs(ZOOMS[best] - cam.z) ? n : best), 0)
    const n = clamp(near + stepBy, 0, ZOOMS.length - 1)
    if (ZOOMS[n] === cam.z) return
    const [wx, wy] = px === undefined ? [cam.x, cam.y] : toWorld(px, py ?? 0)
    const z0 = cam.z
    tween = null
    userCam = true
    setZoom(ZOOMS[n])
    cam.x = wx - ((wx - cam.x) * z0) / cam.z
    cam.y = wy - ((wy - cam.y) * z0) / cam.z
  }

  function roomInView(R: RoomEntry) {
    const w = stage.width / zr() / 2
    const h = stage.height / zr() / 2
    return R.ox + R.b.x1 > cam.x - w && R.ox + R.b.x0 < cam.x + w && R.oy + R.b.y1 > cam.y - h && R.oy + R.b.y0 - 80 < cam.y + h
  }

  function blit(cv: HTMLCanvasElement, ratio: number, wx: number, wy: number) {
    const k = zr() / ratio
    ctx.imageSmoothingEnabled = k < 0.999
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(cv, 0, 0, cv.width, cv.height, Math.round(devX(wx)), Math.round(devY(wy)), Math.round(cv.width * k), Math.round(cv.height * k))
    ctx.imageSmoothingEnabled = false
  }

  function actorScreen(R: RoomEntry, a: Actor) {
    const [gx, gy] = iso(a.i, a.j, 0)
    return { x: R.ox + gx, y: R.oy + gy }
  }

  function draw(t: number) {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, stage.width, stage.height)
    const list = [...rooms.values()].sort((a, b) => a.plan.room.at[0] + a.plan.room.at[1] - (b.plan.room.at[0] + b.plan.room.at[1]) || a.plan.room.at[0] - b.plan.room.at[0])
    const now = performance.now()
    for (const R of list) {
      if (!roomInView(R)) continue
      // A soft drop shadow under the room's card.
      ctx.save()
      ctx.fillStyle = 'rgba(120, 80, 60, 0.13)'
      ctx.beginPath()
      const corners = [iso(0, 0, 0), iso(9, 0, 0), iso(9, 9, 0), iso(0, 9, 0)].map(([x, y]) => [devX(R.ox + x + 14), devY(R.oy + y + 22)])
      corners.forEach(([x, y], n) => (n ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.fill()
      ctx.restore()
      const base = baseOf(R)
      blit(base.cv, base.ratio, R.ox + R.b.x0, R.oy + R.b.y0)
      const things: Array<{ key: number; it?: Item; actor?: Actor }> = []
      for (const it of R.plan.items) {
        const k = kinds[it.kind]
        if (k && layerOf(k) === 'stand') things.push({ key: depthOf(k, it), it })
      }
      const actor = actors.get(R.plan.botId)
      if (actor) things.push({ key: actor.i + actor.j + (actor.z > 0 ? 0.3 : 0.01), actor })
      things.sort((a, b) => a.key - b.key)
      for (const th of things) {
        if (th.actor) {
          const p = actorScreen(R, th.actor)
          ctx.save()
          ctx.setTransform(zr() * SCALE, 0, 0, zr() * SCALE, Math.round(devX(p.x)), Math.round(devY(p.y)))
          drawMascot(mkHand(ctx, { seed: 5 }), looks.get(th.actor.id)!, poseOf(th.actor, t, now))
          ctx.restore()
          continue
        }
        const s = spriteOf(th.it!)
        blit(s.cv, s.ratio, R.ox + s.x0, R.oy + s.y0)
      }
    }
  }

  // ---------------- input ----------------
  const at = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = stage.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }
  let drag: { x: number; y: number } | null = null
  let moved = 0
  const pointers = new Map<number, [number, number]>()
  let pinch: { d: number; z: number } | null = null

  function pick(px: number, py: number) {
    const [wx, wy] = toWorld(px, py)
    // Bots first: a circle round the body.
    let best: { id: string; d: number } | null = null
    for (const [id, a] of actors) {
      const R = rooms.get(id)
      if (!R) continue
      const p = actorScreen(R, a)
      const cy = p.y - (BODY / 2 + a.z * 32 + 4) * SCALE
      const d = Math.hypot(wx - p.x, wy - cy)
      if (d < BODY * SCALE * 0.75 && (!best || d < best.d)) best = { id, d }
    }
    if (best) return { botId: best.id, bot: true }
    // Then the room whose floor diamond (or walls above it) is under the pointer.
    for (const R of [...rooms.values()].reverse()) {
      const lx = wx - R.ox
      const ly = wy - R.oy
      const i = ly / 32 + lx / 64
      const j = ly / 32 - lx / 64
      if (i >= -0.3 && j >= -0.3 && i <= 9.3 && j <= 9.3) return { botId: R.plan.botId, bot: false }
      if (lx > R.b.x0 && lx < R.b.x1 && ly > R.b.y0 && ly < 0 && i + j < 6) return { botId: R.plan.botId, bot: false }
    }
    return null
  }

  stage.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, at(e))
    stage.setPointerCapture?.(e.pointerId)
    moved = 0
    drag = { x: at(e)[0], y: at(e)[1] }
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: cam.z }
    }
  })
  stage.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, at(e))
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      setZoom(clamp((pinch.z * Math.hypot(a[0] - b[0], a[1] - b[1])) / pinch.d, ZOOMS[0], ZOOMS[ZOOMS.length - 1]))
      moved = 99
      userCam = true
      return
    }
    if (drag) {
      const [ex, ey] = at(e)
      const dx = ex - drag.x
      const dy = ey - drag.y
      moved += Math.abs(dx) + Math.abs(dy)
      if (moved > 4) {
        cam.x -= dx / cam.z
        cam.y -= dy / cam.z
        userCam = true
        tween = null
        stage.classList.add('is-drag')
      }
      drag = { x: ex, y: ey }
      return
    }
    const hit = pick(...at(e))
    stage.classList.toggle('is-bot', Boolean(hit?.bot))
  })
  const end = (e: PointerEvent) => {
    pointers.delete(e.pointerId)
    if (pointers.size < 2) pinch = null
    stage.classList.remove('is-drag')
    if (drag && moved <= 4 && e.type === 'pointerup') {
      const hit = pick(...at(e))
      if (hit?.bot) {
        const a = actors.get(hit.botId)
        if (a) poke(a, performance.now())
      }
      onPick(hit)
    }
    drag = null
  }
  stage.addEventListener('pointerup', end)
  stage.addEventListener('pointercancel', end)
  // On the whole view, so wheel zoom also works over signs and bubbles.
  view.addEventListener(
    'wheel',
    (e) => {
      // Plain scrolling over a bubble scrolls its text; Cmd or Ctrl zooms there too.
      if (!(e.ctrlKey || e.metaKey) && e.target !== stage) return
      e.preventDefault()
      // The wheel (and a trackpad pinch) zooms at the pointer; drag to pan.
      const [px, py] = at(e)
      const [wx, wy] = toWorld(px, py)
      const z0 = cam.z
      // Trackpad pinches send small deltas, mouse wheels big ones: cap each step.
      const delta = clamp(e.deltaY * (e.deltaMode ? 30 : 1), -25, 25)
      setZoom(clamp(cam.z * Math.exp(-delta * 0.01), ZOOMS[0], ZOOMS[ZOOMS.length - 1]))
      cam.x = wx - ((wx - cam.x) * z0) / cam.z
      cam.y = wy - ((wy - cam.y) * z0) / cam.z
      tween = null
      userCam = true
    },
    { passive: false },
  )

  function resize() {
    const r = view.getBoundingClientRect()
    const d = Math.min(2, window.devicePixelRatio || 1)
    vw = r.width
    vh = r.height
    stage.width = Math.round(vw * d)
    stage.height = Math.round(vh * d)
    if (d !== dpr) {
      dpr = d
      sprites.clear()
      for (const R of rooms.values()) R.base = null
    }
    if (!userCam) fit(false)
    draw(clock)
  }

  function tick(now: number) {
    const t = now / 1000
    const dt = Math.min(0.05, lastT ? t - lastT : 0.016)
    lastT = t
    clock += dt
    if (tween) {
      const u = Math.min(1, (clock - tween.t0) / tween.d)
      // Ease out back: a little overshoot, like the camera is on a spring.
      const c1 = 1.2
      const e = 1 + (c1 + 1) * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2)
      cam.x = lerp(tween.x0, tween.x1, e)
      cam.y = lerp(tween.y0, tween.y1, e)
      setZoom(lerp(tween.z0, tween.z1, clamp(e, 0, 1.05)))
      if (u >= 1) tween = null
    }
    const wall = performance.now()
    for (const a of actors.values()) step(a, dt, wall)
    draw(clock)
    for (const fn of frameListeners) fn()
  }
  function frame(now: number) {
    raf = requestAnimationFrame(frame)
    tick(now)
  }

  const ro = new ResizeObserver(() => resize())

  return {
    // Rooms come and go with the bots; a room is re-printed only when its plan changed.
    setOffice({ plans, kinds: k, lives, botLooks }: { plans: RoomPlan[]; kinds: Record<string, Kind>; lives: Record<string, Presence>; botLooks: Record<string, Look> }) {
      kinds = k
      const now = performance.now()
      const wallNow = Date.now()
      const keep = new Set(plans.map((p) => p.botId))
      for (const id of [...rooms.keys()]) if (!keep.has(id)) rooms.delete(id)
      for (const id of [...actors.keys()]) if (!keep.has(id)) actors.delete(id)
      for (const plan of plans) {
        looks.set(plan.botId, botLooks[plan.botId])
        const ver = JSON.stringify([plan.room, plan.items])
        const [ox, oy] = roomOrigin(plan.room.at)
        const have = rooms.get(plan.botId)
        if (!have || have.ver !== ver) rooms.set(plan.botId, { plan, ox, oy, b: roomBounds(plan.room), ver, base: null })
        const actor = actors.get(plan.botId)
        if (!actor) actors.set(plan.botId, createActor({ plan, live: lives[plan.botId], now: wallNow }))
        else {
          actor.plan = plan
          setLive(actor, lives[plan.botId], now)
        }
      }
      if (!userCam) fit(false)
    },
    setLive(botId: string, live: Presence) {
      const a = actors.get(botId)
      if (a) setLive(a, live, performance.now())
    },
    poke(botId: string) {
      const a = actors.get(botId)
      if (a) poke(a, performance.now())
    },
    mood: (botId: string) => actors.get(botId)?.mood ?? null,
    // Where a bot's head and its room's sign are on the page, in CSS px.
    anchors(botId: string) {
      const R = rooms.get(botId)
      const a = actors.get(botId)
      if (!R || !a) return null
      const p = actorScreen(R, a)
      const head = { x: devX(p.x) / dpr, y: devY(p.y - (BODY + 8 + a.z * 32) * SCALE) / dpr }
      // The sign hangs over the room's back corner, the top of its box.
      const corner = iso(0, 0, WALL_H)
      const sign = { x: devX(R.ox + corner[0]) / dpr, y: devY(R.oy + corner[1] - 10) / dpr }
      const inView = (q: { x: number; y: number }) => q.x > -100 && q.y > -100 && q.x < vw + 100 && q.y < vh + 100
      return { head: { ...head, visible: inView(head) }, sign: { ...sign, visible: inView(sign) }, zoom: cam.z }
    },
    onFrame(fn: () => void) {
      frameListeners.push(fn)
    },
    focus,
    fit() {
      userCam = false
      fit(true)
    },
    zoomBy(stepBy: number) {
      zoomBy(stepBy)
    },
    start() {
      ro.observe(view)
      raf = requestAnimationFrame(frame)
    },
    stop() {
      cancelAnimationFrame(raf)
      ro.disconnect()
    },
    debug: { cam, actors },
  }
}
