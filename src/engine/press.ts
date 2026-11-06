// The press: one cream sheet printed in riso inks, where every tint is an
// ordered (Bayer) dither instead of a halftone dot. Inks overprint (multiply);
// the screens are anchored to the canvas so the dots never beat when panning.
//
// Everything here is pure geometry and canvas work. No app state.

export type Vec = [number, number]
export type Rng = () => number
export type InkName = 'blue' | 'coral' | 'sun' | 'teal' | 'black' | 'paper'
export type Paul = [number, number, number?]

export const TAU = Math.PI * 2

// ---------------- rng ----------------
export function mul32(a: number): Rng {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export function hmix(h: number, v: number): number {
  h = Math.imul(h ^ (v | 0), 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}
export function strHash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
export function streamOf(...ks: (string | number)[]): Rng {
  let h = 0x9e3779b9
  for (const k of ks) h = hmix(h, typeof k === 'string' ? strHash(k) : k)
  const f = mul32(h)
  for (let i = 0; i < 11; i++) f()
  return f
}
export const rd = (R: Rng, a: number, b: number) => a + R() * (b - a)
export const ri = (R: Rng, a: number, b: number) => Math.floor(rd(R, a, b + 1))
export const ch = (R: Rng, p: number) => R() < p
export const pk = <T,>(R: Rng, arr: T[]): T => arr[(R() * arr.length) | 0]
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const sm = (t: number) => t * t * (3 - 2 * t)
export const sstep = (a: number, b: number, t: number) => sm(clamp((t - a) / (b - a), 0, 1))
export const fract = (v: number) => v - Math.floor(v)
export const tri = (t: number) => 1 - Math.abs(fract(t) * 2 - 1)
export const bump = (a: number, b: number, u: number) => (u <= a || u >= b ? 0 : Math.sin(((u - a) / (b - a)) * Math.PI))

// ---------------- geometry ----------------
export function resample(pts: Vec[], step: number): Vec[] {
  if (pts.length < 2) return pts.slice()
  const out: Vec[] = [[pts[0][0], pts[0][1]]]
  let need = step
  for (let i = 1; i < pts.length; i++) {
    let x0 = pts[i - 1][0],
      y0 = pts[i - 1][1]
    const x1 = pts[i][0],
      y1 = pts[i][1]
    let d = Math.hypot(x1 - x0, y1 - y0)
    while (d >= need && d > 0) {
      const t = need / d
      x0 += (x1 - x0) * t
      y0 += (y1 - y0) * t
      out.push([x0, y0])
      d -= need
      need = step
    }
    need -= d
  }
  const L = pts[pts.length - 1]
  const E = out[out.length - 1]
  if (Math.hypot(L[0] - E[0], L[1] - E[1]) > step * 0.3) out.push([L[0], L[1]])
  return out
}
export function chaikin(pts: Vec[], closed: boolean, it: number): Vec[] {
  let p = pts.slice()
  for (let k = 0; k < it; k++) {
    const q: Vec[] = []
    const n = p.length
    if (closed) {
      for (let i = 0; i < n; i++) {
        const a = p[i]
        const b = p[(i + 1) % n]
        q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75])
      }
    } else {
      q.push(p[0])
      for (let i = 0; i < n - 1; i++) {
        const a = p[i]
        const b = p[i + 1]
        q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75])
      }
      q.push(p[n - 1])
    }
    p = q
  }
  return p
}
export const curve = (pts: Vec[], it = 3) => chaikin(pts, false, it)
export const loop = (pts: Vec[], it = 3) => chaikin(pts, true, it)
export function bbox(pts: Vec[]): [number, number, number, number] {
  let x0 = 1e9,
    y0 = 1e9,
    x1 = -1e9,
    y1 = -1e9
  for (const p of pts) {
    if (p[0] < x0) x0 = p[0]
    if (p[0] > x1) x1 = p[0]
    if (p[1] < y0) y0 = p[1]
    if (p[1] > y1) y1 = p[1]
  }
  return [x0, y0, x1, y1]
}
export function pip(P: Vec[], x: number, y: number): boolean {
  let inside = false
  const n = P.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = P[i][0]
    const yi = P[i][1]
    const xj = P[j][0]
    const yj = P[j][1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
export function centroid(P: Vec[]): Vec {
  let x = 0
  let y = 0
  for (const p of P) {
    x += p[0]
    y += p[1]
  }
  return [x / P.length, y / P.length]
}
export const dist = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1])
export const rect = (x0: number, y0: number, x1: number, y1: number): Vec[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
]
export const lerpP = (a: Vec, b: Vec, t: number): Vec => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)]
export function blob(R: Rng, cx: number, cy: number, rx: number, ry: number, rot0?: number): Vec[] {
  const n = Math.max(12, Math.round((rx + ry) / 3))
  const pts: Vec[] = []
  const rot = rot0 ?? rd(R, 0, TAU)
  const a1 = rd(R, 0.04, 0.1)
  const a2 = rd(R, 0.02, 0.05)
  const p1 = rd(R, 0, 7)
  const p2 = rd(R, 0, 7)
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU
    const m = 1 + a1 * Math.sin(t * 2 + p1) + a2 * Math.sin(t * 5 + p2)
    const x = Math.cos(t) * rx * m
    const y = Math.sin(t) * ry * m
    pts.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)])
  }
  return pts
}
export function rotPts(pts: Vec[], cx: number, cy: number, rot: number): Vec[] {
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  return pts.map((p) => {
    const x = p[0] - cx
    const y = p[1] - cy
    return [cx + x * c - y * s, cy + x * s + y * c]
  })
}
export function arcPts(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n: number): Vec[] {
  const p: Vec[] = []
  for (let i = 0; i <= n; i++) {
    const t = a0 + ((a1 - a0) * i) / n
    p.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry])
  }
  return p
}
export const ell = (cx: number, cy: number, rx: number, ry: number, n?: number): Vec[] => {
  n = n || Math.max(14, Math.round((rx + ry) * 0.6))
  return arcPts(cx, cy, rx, ry, 0, TAU, n).slice(0, n)
}
export const circ = (cx: number, cy: number, r: number, n?: number) => ell(cx, cy, r, r, n)
export function polyPts(cx: number, cy: number, r: number, n: number, rot = 0): Vec[] {
  const p: Vec[] = []
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU
    p.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
  }
  return p
}
export function starPts(cx: number, cy: number, r1: number, r2: number, n: number, rot = 0): Vec[] {
  const p: Vec[] = []
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i / (n * 2)) * TAU
    const r = i % 2 ? r2 : r1
    p.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
  }
  return p
}
export const tr = (pts: Vec[], dx: number, dy: number): Vec[] => pts.map((p) => [p[0] + dx, p[1] + dy])
export const sc = (pts: Vec[], cx: number, cy: number, k: number, ky?: number): Vec[] =>
  pts.map((p) => [cx + (p[0] - cx) * k, cy + (p[1] - cy) * (ky ?? k)])
export function roundRect(x0: number, y0: number, x1: number, y1: number, r: number, n = 4): Vec[] {
  r = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2)
  return ([] as Vec[]).concat(
    arcPts(x1 - r, y0 + r, r, r, -Math.PI / 2, 0, n),
    arcPts(x1 - r, y1 - r, r, r, 0, Math.PI / 2, n),
    arcPts(x0 + r, y1 - r, r, r, Math.PI / 2, Math.PI, n),
    arcPts(x0 + r, y0 + r, r, r, Math.PI, Math.PI * 1.5, n),
  )
}
// A thick ribbon around a polyline: the width may be a number or a function of t.
export function ribbon(pts: Vec[], w: number | ((t: number) => number)): Vec[] {
  const n = pts.length
  const L: Vec[] = []
  const Rr: Vec[] = []
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(n - 1, i + 1)]
    let nx = -(b[1] - a[1])
    let ny = b[0] - a[0]
    const d = Math.hypot(nx, ny) || 1
    nx /= d
    ny /= d
    const ww = (typeof w === 'function' ? w(n > 1 ? i / (n - 1) : 0) : w) / 2
    L.push([pts[i][0] + nx * ww, pts[i][1] + ny * ww])
    Rr.push([pts[i][0] - nx * ww, pts[i][1] - ny * ww])
  }
  return L.concat(Rr.reverse())
}

// ---------------- iso ----------------
// A tile is a diamond 64 wide and 32 tall; one unit of height is 32 tall.
// i runs down-right, j runs down-left, z goes up. Light comes from the upper
// left: tops lit, +j faces half shade, +i faces full shade.
export const TW = 64
export const TH = 32
export const TZ = 32
export const isoX = (i: number, j: number) => (i - j) * (TW / 2)
export const isoY = (i: number, j: number, z?: number) => (i + j) * (TH / 2) - (z || 0) * TZ
export const iso = (i: number, j: number, z: number): Vec => [isoX(i, j), isoY(i, j, z)]

// ===========================================================================
// THE INKS
// ===========================================================================
export const PAPER: [number, number, number] = [243, 235, 221]
export const INK: Record<InkName, [number, number, number]> = {
  blue: [52, 74, 128],
  coral: [238, 104, 82],
  sun: [255, 212, 40],
  teal: [0, 140, 138],
  black: [36, 34, 38],
  paper: PAPER,
}
export const INK_NAMES = ['blue', 'coral', 'sun', 'teal', 'black', 'paper'] as const
// Each drum's plate sits a hair off register, a fixed amount.
export const PLATE: Record<InkName, Vec> = {
  blue: [0, 0],
  coral: [-0.5, 0.35],
  sun: [0.4, 0.55],
  teal: [-0.35, -0.45],
  black: [0, 0],
  paper: [0, 0],
}
export const rgb = (c: readonly number[], a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`

// The screen: an 8x8 ordered dither. Every drum shares the matrix, so a second
// tint lands on the same dots as the first and darkens them.
export const BAYER = (() => {
  const m = [
    [0, 2],
    [3, 1],
  ]
  let M = m
  for (let n = 2; n < 8; n *= 2) {
    const N: number[][] = []
    for (let y = 0; y < 2 * n; y++) {
      N.push([])
      for (let x = 0; x < 2 * n; x++) N[y].push(4 * M[y % n][x % n] + m[(y / n) | 0][(x / n) | 0])
    }
    M = N
  }
  return M
})()
const SHIFT: Record<InkName, Vec> = {
  blue: [0, 0],
  coral: [0, 0],
  sun: [0, 0],
  teal: [0, 0],
  black: [0, 0],
  paper: [4, 4],
}
export const DP = 1 // world units per dither pixel
export const LEVELS = 64

// The screen can be switched off: tints then print as a flat ink wash at the
// same tone (an alpha overprint), which shows what the dither was doing.
let ditherOn = true
let ditherGamma = 1
export const isDitherOn = () => ditherOn
export function setDither(on: boolean, gamma = 1) {
  ditherOn = on
  ditherGamma = gamma
}
// A flat wash reads lighter than a screen of the same average: gamma pushes the tone back up.
// A wash is the multiply colour that darkens the base by the same amount the
// screen would: opaque, so outlines keep their weight (an alpha wash fades them).
export const washColor = (ink: InkName, tone: number) => {
  const t = Math.pow(clamp(tone, 0, 1), ditherGamma)
  const c = INK[ink]
  return rgb([255 - (255 - c[0]) * t, 255 - (255 - c[1]) * t, 255 - (255 - c[2]) * t])
}

const TILES = new Map<string, HTMLCanvasElement>()
export function ditherTile(ink: InkName, level: number): HTMLCanvasElement {
  const key = ink + '|' + level
  const have = TILES.get(key)
  if (have) return have
  const cv = document.createElement('canvas')
  cv.width = 8
  cv.height = 8
  const c = cv.getContext('2d')!
  const im = c.createImageData(8, 8)
  const col = INK[ink]
  const [sx, sy] = SHIFT[ink]
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++)
      if (BAYER[(y + sy) & 7][(x + sx) & 7] < level) {
        const o = (y * 8 + x) * 4
        im.data[o] = col[0]
        im.data[o + 1] = col[1]
        im.data[o + 2] = col[2]
        im.data[o + 3] = 255
      }
  c.putImageData(im, 0, 0)
  TILES.set(key, cv)
  return cv
}

const BANKS = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern>>()
export function inkPattern(ctx: CanvasRenderingContext2D, ink: InkName, tone: number, fine?: boolean): CanvasPattern {
  let bank = BANKS.get(ctx)
  if (!bank) {
    bank = new Map()
    BANKS.set(ctx, bank)
  }
  const level = clamp(Math.round(tone * LEVELS), 1, LEVELS)
  const key = ink + '|' + level + '|' + (fine ? 1 : 0)
  let p = bank.get(key)
  if (!p) {
    p = ctx.createPattern(ditherTile(ink, level), 'repeat')!
    const s = (fine ? 0.5 : 1) * DP
    if (p.setTransform) p.setTransform(new DOMMatrix().scaleSelf(s, s))
    bank.set(key, p)
  }
  return p
}

// ===========================================================================
// THE HAND
// ===========================================================================
// mkHand(ctx, {ox, oy, seed, fine}) makes a hand that prints on ctx. ox, oy
// shift the origin (rooms draw in their own iso coordinates).
//
//   H.fill(P, ink, tone)    knock the shape out of what is below, then print it
//   H.tint(P, ink, tone)    overprint only: shadows, glass, light, water
//   H.knock(P)              paper, and nothing else
//   H.line(R, pts, ink, w)  a pen line in that ink
//   H.grad(P, ink, t0, t1, a, b)  a screen that grows from tone t0 at a to t1 at b
//   H.glow(x, y, rx, ry, ink, tone)  a soft dithered halo
//   H.light(x, y, rx, ry)   a halo of paper: light in a dark room

export interface FillOptions {
  knock?: boolean
  fine?: boolean
}
export interface LineOptions {
  tone?: number
  amp?: number
  taper?: 'in' | 'out' | true
  cap?: CanvasLineCap
  dash?: number[] | null
  closed?: boolean
  fine?: boolean
}
export interface Hand {
  RB: Rng
  ox: number
  oy: number
  ctx: () => CanvasRenderingContext2D
  pathOf: (c: CanvasRenderingContext2D, P: Vec[], dx?: number, dy?: number) => void
  p: (i: number, j: number, z?: number) => Vec
  tile: (i: number, j: number, w: number, d: number, z?: number) => Vec[]
  faceI: (i: number, j: number, len: number, z0: number, z1: number) => Vec[]
  faceJ: (i: number, j: number, len: number, z0: number, z1: number) => Vec[]
  path: (pts: Paul[]) => Vec[]
  knock: (P: Vec[], o?: { a?: number }) => void
  tint: (P: Vec[], ink: InkName, tone?: number, o?: FillOptions) => void
  fill: (P: Vec[], ink: InkName, tone?: number, o?: FillOptions) => void
  fill2: (P: Vec[], ink: InkName, tone: number, ink2: InkName, tone2: number, o?: FillOptions) => void
  erase: (P: Vec[]) => void
  flat: (P: Vec[], css: string) => void
  grad: (P: Vec[], ink: InkName, t0: number, t1: number, a: Vec, b: Vec, n?: number, o?: FillOptions) => void
  glow: (x: number, y: number, rx: number, ry: number, ink?: InkName, tone?: number, n?: number) => void
  light: (x: number, y: number, rx: number, ry: number, strength?: number, n?: number) => void
  wob: (rs: Vec[], amp: number) => Vec[]
  line: (R: Rng | null, pts: Vec[], ink?: InkName, w?: number, o?: LineOptions) => void
  outline: (R: Rng | null, P: Vec[], ink?: InkName, w?: number, o?: LineOptions) => void
  dot: (x: number, y: number, r: number, ink?: InkName, tone?: number, o?: FillOptions) => void
  speckle: (R: Rng, P: Vec[], ink: InkName, n: number, r0?: number, r1?: number, tone?: number) => void
  clip: <T,>(P: Vec[], fn: () => T) => T
  opacity: <T,>(alpha: number, fn: () => T) => T | undefined
  img: (im: CanvasImageSource, x: number, y: number, w: number, h: number) => void
}

const PAPER_RGB = rgb(PAPER)
const NO_DASH: number[] = []

export function mkHand(cx: CanvasRenderingContext2D, o: { ox?: number; oy?: number; seed?: number; fine?: boolean } = {}): Hand {
  const ox = o.ox || 0
  const oy = o.oy || 0
  const FINE = !!o.fine
  const RB = streamOf(o.seed ?? 0, 'hand')

  const path = (c: CanvasRenderingContext2D, P: Vec[], dx = 0, dy = 0) => {
    c.beginPath()
    for (let i = 0; i < P.length; i++) {
      if (i) c.lineTo(P[i][0] + dx, P[i][1] + dy)
      else c.moveTo(P[i][0] + dx, P[i][1] + dy)
    }
    c.closePath()
  }

  const printInk = (ink: InkName, tone: number, draw: (st: CanvasPattern | string, dx: number, dy: number) => void, fine?: boolean, soft?: boolean) => {
    const k: InkName = INK[ink] ? ink : 'blue'
    const j = PLATE[k]
    if (k !== 'paper') cx.globalCompositeOperation = 'multiply'
    const st = ditherOn ? inkPattern(cx, k, tone, fine ?? FINE) : soft ? rgb(INK[k], Math.pow(clamp(tone, 0, 1), ditherGamma)) : washColor(k, tone)
    draw(st, j[0], j[1])
    if (k !== 'paper') cx.globalCompositeOperation = 'source-over'
  }

  const H: Hand = {
    RB,
    ox,
    oy,
    ctx: () => cx,
    pathOf: path,
    p: (i, j, z) => [isoX(i, j) + ox, isoY(i, j, z) + oy],
    tile: (i, j, w, d, z) => [H.p(i, j, z), H.p(i + w, j, z), H.p(i + w, j + d, z), H.p(i, j + d, z)],
    faceI: (i, j, len, z0, z1) => [H.p(i, j, z0), H.p(i + len, j, z0), H.p(i + len, j, z1), H.p(i, j, z1)],
    faceJ: (i, j, len, z0, z1) => [H.p(i, j, z0), H.p(i, j + len, z0), H.p(i, j + len, z1), H.p(i, j, z1)],
    path: (pts) => pts.map((p) => H.p(p[0], p[1], p[2] || 0)),
    knock: (P, o2 = {}) => {
      if (P.length < 3) return
      const a = o2.a ?? 1
      path(cx, P)
      cx.fillStyle = a === 1 ? PAPER_RGB : rgb(PAPER, a)
      cx.fill()
    },
    tint: (P, ink, tone = 1, o2) => {
      if (P.length < 3 || tone <= 0) return
      printInk(
        ink,
        tone,
        (st, dx, dy) => {
          path(cx, P, dx, dy)
          cx.fillStyle = st
          cx.fill()
        },
        o2?.fine,
      )
    },
    fill: (P, ink, tone = 1, o2) => {
      if (P.length < 3) return
      if (o2?.knock !== false) H.knock(P)
      if (tone > 0) H.tint(P, ink, tone, o2)
    },
    fill2: (P, ink, tone, ink2, tone2, o2) => {
      H.fill(P, ink, tone, o2)
      H.tint(P, ink2, tone2, o2)
    },
    erase: (P) => {
      cx.globalCompositeOperation = 'destination-out'
      path(cx, P)
      cx.fillStyle = '#000'
      cx.fill()
      cx.globalCompositeOperation = 'source-over'
    },
    flat: (P, css) => {
      path(cx, P)
      cx.fillStyle = css
      cx.fill()
    },
    grad: (P, ink, t0, t1, a, b, n = 12, o2) => {
      if (P.length < 3) return
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      const L = Math.hypot(dx, dy) || 1
      const ux = dx / L
      const uy = dy / L
      const nx = -uy
      const ny = ux
      const W = 4000
      cx.save()
      path(cx, P)
      cx.clip()
      for (let k = 0; k < n; k++) {
        const s0 = (k / n) * L - (k ? 0 : W)
        const s1 = ((k + 1) / n) * L + (k === n - 1 ? W : 0)
        const t = lerp(t0, t1, (k + 0.5) / n)
        if (t <= 0.02) continue
        const B: Vec[] = [
          [a[0] + ux * s0 + nx * W, a[1] + uy * s0 + ny * W],
          [a[0] + ux * (s1 + 0.5) + nx * W, a[1] + uy * (s1 + 0.5) + ny * W],
          [a[0] + ux * (s1 + 0.5) - nx * W, a[1] + uy * (s1 + 0.5) - ny * W],
          [a[0] + ux * s0 - nx * W, a[1] + uy * s0 - ny * W],
        ]
        printInk(
          ink,
          t,
          (st) => {
            path(cx, B)
            cx.fillStyle = st
            cx.fill()
          },
          o2?.fine,
        )
      }
      cx.restore()
    },
    glow: (x, y, rx, ry, ink = 'sun', tone = 0.6, n = 8) => {
      if (tone <= 0.02 || rx <= 0 || ry <= 0) return
      rings(ink, x, y, rx, ry, n, (f0, f1) => tone * Math.pow(1 - (f0 + f1) / 2, 1.3))
    },
    light: (x, y, rx, ry, strength = 1, n = 8) => {
      if (strength <= 0.02 || rx <= 0 || ry <= 0) return
      rings('paper', x, y, rx, ry, n, (f0, f1) => strength * (1.35 - ((f0 + f1) / 2) * 1.35))
    },
    wob: (rs, amp) => {
      const n = rs.length
      const q: Vec[] = new Array(n)
      const P1 = rd(RB, 0, 7)
      const P2 = rd(RB, 0, 7)
      const F1 = rd(RB, 1.4, 3)
      const F2 = rd(RB, 5, 9)
      for (let i = 0; i < n; i++) {
        const t = n > 1 ? i / (n - 1) : 0
        const A = rs[i > 0 ? i - 1 : 0]
        const B = rs[i < n - 1 ? i + 1 : n - 1]
        let nx = -(B[1] - A[1])
        let ny = B[0] - A[0]
        const d = Math.hypot(nx, ny) || 1
        nx /= d
        ny /= d
        const off = amp * (0.65 * Math.sin(t * F1 * 2 + P1) + 0.35 * Math.sin(t * F2 + P2))
        q[i] = [rs[i][0] + nx * off + rd(RB, -0.1, 0.1), rs[i][1] + ny * off + rd(RB, -0.1, 0.1)]
      }
      return q
    },
    line: (_R, pts, ink = 'blue', w = 1.4, o2 = {}) => {
      if (!pts || pts.length < 2) return
      const src = o2.closed ? pts.concat([pts[0]]) : pts
      const rs = resample(src, Math.max(2.5, w * 1.4))
      if (rs.length < 2) return
      const amp = o2.amp ?? Math.min(0.6, w * 0.15 + 0.15)
      const q = amp > 0 ? H.wob(rs, amp) : rs
      const tone = o2.tone ?? 1
      const taper = o2.taper
      if (taper) {
        const P = ribbon(q, (t) => {
          let e: number
          if (taper === 'out') e = 0.2 + 0.8 * (1 - t)
          else if (taper === 'in') e = 0.2 + 0.8 * t
          else e = 0.25 + 0.75 * Math.min(1, Math.min(t, 1 - t) / 0.25)
          return Math.max(0.3, w * e)
        })
        printInk(
          ink,
          tone >= 0.75 ? 1 : tone,
          (st, dx, dy) => {
            path(cx, P, dx, dy)
            cx.fillStyle = st
            cx.fill()
          },
          o2.fine,
        )
        return
      }
      const dash = o2.dash
      printInk(
        ink,
        tone >= 0.75 ? 1 : tone,
        (st, dx, dy) => {
          cx.strokeStyle = st
          cx.lineWidth = w
          cx.lineCap = o2.cap || 'round'
          cx.lineJoin = 'round'
          if (dash) cx.setLineDash(dash)
          cx.beginPath()
          cx.moveTo(q[0][0] + dx, q[0][1] + dy)
          for (let i = 1; i < q.length; i++) cx.lineTo(q[i][0] + dx, q[i][1] + dy)
          cx.stroke()
          if (dash) cx.setLineDash(NO_DASH)
        },
        o2.fine,
      )
    },
    outline: (R, P, ink = 'blue', w = 1.3, o2 = {}) => H.line(R, P, ink, w, { ...o2, closed: true }),
    dot: (x, y, r, ink = 'blue', tone = 1, o2 = {}) => {
      const P = circ(x, y, r, Math.max(8, Math.round(r * 2.5)))
      if (o2.knock) H.fill(P, ink, tone, o2)
      else H.tint(P, ink, tone, o2)
    },
    speckle: (R, P, ink, n, r0 = 0.6, r1 = 1.4, tone = 1) => {
      const [x0, y0, x1, y1] = bbox(P)
      const dots: [number, number, number][] = []
      for (let k = 0; k < n; k++) {
        const x = rd(R, x0, x1)
        const y = rd(R, y0, y1)
        if (pip(P, x, y)) dots.push([x, y, rd(R, r0, r1)])
      }
      printInk(
        ink,
        tone,
        (st, dx, dy) => {
          cx.fillStyle = st
          cx.beginPath()
          for (const d of dots) {
            cx.moveTo(d[0] + d[2] + dx, d[1] + dy)
            cx.arc(d[0] + dx, d[1] + dy, d[2], 0, TAU)
          }
          cx.fill()
        },
        undefined,
      )
    },
    clip: (P, fn) => {
      cx.save()
      path(cx, P)
      cx.clip()
      try {
        return fn()
      } finally {
        cx.restore()
      }
    },
    opacity: (alpha, fn) => {
      alpha = clamp(Number.isFinite(alpha) ? alpha : 1, 0, 1)
      if (alpha <= 0) return
      if (alpha >= 1) return fn()
      cx.save()
      cx.globalAlpha *= alpha
      try {
        return fn()
      } finally {
        cx.restore()
      }
    },
    img: (im, x, y, w, h) => cx.drawImage(im, x, y, w, h),
  }

  // A halo, densest at the heart: each band an annulus with its own screen.
  const rings = (ink: InkName, x: number, y: number, rx: number, ry: number, n: number, toneAt: (f0: number, f1: number) => number) => {
    for (let k = 0; k < n; k++) {
      const f0 = k / n
      const f1 = (k + 1) / n
      const t = clamp(toneAt(f0, f1), 0, 1)
      if (t <= 0.03) continue
      printInk(
        ink,
        t,
        (st) => {
          cx.beginPath()
          cx.ellipse(x, y, rx * f1, ry * f1, 0, 0, TAU)
          if (k) {
            cx.moveTo(x + rx * f0, y)
            cx.ellipse(x, y, rx * f0, ry * f0, 0, 0, TAU, true)
          }
          cx.fillStyle = st
          cx.fill('evenodd')
        },
        undefined,
        true,
      )
    }
  }

  return H
}
