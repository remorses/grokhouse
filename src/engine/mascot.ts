// The Grok Bot mascots: small 3D toys in the avatar shapes and colours of the Grok Bot
// app (blob, cloud, square, sparkle, clover, heart, flower, teardrop, tablet, wedge,
// house, star, hex, and the older ones). Outlines come from the app's own shape code
// (scripts/extract-mascot-shapes.ts); each gets a body like the app builds it:
//
//   blob                          ──▶ sphere
//   teardrop, wedge, pebble, …    ──▶ revolve the outline round its vertical axis
//   tablet                        ──▶ revolve round the horizontal axis (a pill)
//   cloud, heart                  ──▶ loft: the outline shrunk in rings, puffy
//   square, sparkle, star, hex, … ──▶ extrusion with a rounded bevel
//
// A body is a solid |z| <= zmax(x, y), ray cast into a sprite per yaw (16 turns), lit
// with two toon bands and outlined in a deeper tone of its colour. Eyes are pills on the
// front surface, projected every frame so they blink, squint and turn with the body.
// Drawn in its own space with the ground at (0, 0); scene/actors.ts poses it.

import { TAU, arcPts, circ, ell, loop, roundRect, starPts, type Hand } from './press.ts'
import OUTLINES from './mascot-shapes.json'
import type { Face } from '../types.ts'

export type Eyes = 'open' | 'shut' | 'happy' | 'wide' | 'focus'
export type Mark = null | 'z' | '!' | '?' | 'dots' | 'sparkle' | 'note' | 'sweat' | 'heart'

export type Look = { shape: string; color: string }
export type Pose = {
  t: number
  face: Face
  // Turn round the vertical axis in radians; 0 looks straight at the camera. Defaults to the face.
  yaw?: number
  // Squash (sy < 1) and stretch (sy > 1); sx usually moves the other way.
  sx: number
  sy: number
  // Lean in radians, positive leans right; lift in px above the ground.
  lean: number
  lift: number
  eyes: Eyes
  mark: Mark
  // Lying down in bed: the body tips over a little.
  lying?: boolean
  // 0..1 after a landing: two puffs of dust spread from the body.
  dust?: number | null
}

export const BODY = 30 // px, a blob's diameter before squash
const R = BODY / 2 // px per body unit: a blob has radius 1

// Which way each facing turns the body; the camera looks from +i +j.
export const FACE_YAW: Record<Face, number> = { se: Math.PI / 4, sw: -Math.PI / 4, ne: (Math.PI * 3) / 4, nw: (-Math.PI * 3) / 4 }

// ---------------- shapes ----------------
type Build = { kind: 'sphere' } | { kind: 'revolve' } | { kind: 'pill' } | { kind: 'loft'; depth: number } | { kind: 'slab'; half: number; bevel: number }
// The app's eye layout per shape (width, height, gap between centres, lift), in eye units.
type EyeFit = { w: number; h: number; gap: number; lift: number }
type ShapeDef = { build: Build; size: number; eyes: EyeFit }

const slab = { kind: 'slab', half: 0.36, bevel: 0.22 } as const
const revolve = { kind: 'revolve' } as const
const eyes = (w: number, h: number, gap: number, lift: number): EyeFit => ({ w, h, gap, lift })
const EYES = eyes(0.26, 0.57, 0.64, 0.12)
// Sizes and builds from the app's model table; size 1.17 is a blob.
const SHAPES: Record<string, ShapeDef> = {
  sphere: { build: { kind: 'sphere' }, size: 1.17, eyes: EYES },
  cloud: { build: { kind: 'loft', depth: 0.72 }, size: 1.3455, eyes: eyes(0.213, 0.467, 0.47, 0.07) },
  square: { build: slab, size: 1.0413, eyes: eyes(0.255, 0.56, 0.529, 0.12) },
  sparkle: { build: slab, size: 1.521, eyes: eyes(0.184, 0.403, 0.412, 0) },
  clover: { build: slab, size: 1.0881, eyes: eyes(0.233, 0.511, 0.559, -0.02) },
  heartChubby: { build: { kind: 'loft', depth: 0.62 }, size: 1.3572, eyes: eyes(0.187, 0.409, 0.446, 0.052) },
  starFlower: { build: slab, size: 1.3923, eyes: eyes(0.193, 0.423, 0.383, 0.12) },
  teardrop: { build: revolve, size: 1.318, eyes: eyes(0.208, 0.456, 0.453, 0.18) },
  tablet: { build: { kind: 'pill' }, size: 1.3923, eyes: eyes(0.213, 0.467, 0.588, 0.02) },
  wedge: { build: revolve, size: 1.3591, eyes: eyes(0.213, 0.467, 0.468, 0.18) },
  house: { build: slab, size: 1.17, eyes: eyes(0.23, 0.503, 0.513, 0.185) },
  star6: { build: { kind: 'slab', half: 0.3, bevel: 0.18 }, size: 1.4976, eyes: eyes(0.185, 0.45, 0.419, 0.12) },
  hex: { build: slab, size: 1.2519, eyes: EYES },
  pebble: { build: revolve, size: 1.2168, eyes: eyes(0.239, 0.524, 0.546, 0.12) },
  bean: { build: revolve, size: 1.17, eyes: eyes(0.203, 0.445, 0.461, 0.12) },
  egg: { build: revolve, size: 1.17, eyes: eyes(0.239, 0.524, 0.434, 0.113) },
  squircle: { build: { kind: 'slab', half: 0.28, bevel: 0.11 }, size: 1.17, eyes: eyes(0.239, 0.524, 0.563, 0.12) },
  capsule: { build: revolve, size: 1.17, eyes: eyes(0.211, 0.462, 0.36, 0.12) },
  cylinder: { build: revolve, size: 1.17, eyes: eyes(0.239, 0.524, 0.479, 0.12) },
  gem: { build: revolve, size: 1.17, eyes: eyes(0.239, 0.524, 0.501, 0.12) },
  shield: { build: revolve, size: 1.17, eyes: eyes(0.268, 0.587, 0.445, 0.12) },
  dome: { build: revolve, size: 1.17, eyes: EYES },
  arch: { build: revolve, size: 1.17, eyes: EYES },
  leaf: { build: revolve, size: 1.17, eyes: eyes(0.187, 0.41, 0.448, 0.04) },
}
// Names the app shows in its picker or used to use, mapped to the model they render as.
const ALIAS: Record<string, string> = { blob: 'sphere', heart: 'heartChubby', flower: 'starFlower', star: 'star6', spark: 'sparkle', hexagon: 'hex', crystal: 'gem', sphereWide: 'sphere' }
const shapeName = (name: string) => {
  const key = ALIAS[name] ?? name
  return SHAPES[key] ? key : 'sphere'
}

// ---------------- colours ----------------
// The Grok Bot app's avatar colours.
const COLORS: Record<string, string> = {
  black: '#2a2629',
  white: '#fbf8f2',
  brown: '#9a6e3f',
  red: '#e94b45',
  orange: '#e9742a',
  yellow: '#e99a32',
  green: '#59bf76',
  cyan: '#53b4a3',
  teal: '#53b4a3',
  blue: '#3c83f7',
  violet: '#885ff5',
  purple: '#885ff5',
  magenta: '#e85098',
  pink: '#e85098',
  gray: '#777777',
  grey: '#777777',
}
const INK = '#1d1b1e'

export function bodyHex(name: string) {
  return COLORS[name] ?? COLORS.violet
}
function rgbOf(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [n >> 16, (n >> 8) & 255, n & 255]
}
// k > 0 mixes toward white, k < 0 toward black.
const mixRgb = ([r, g, b]: [number, number, number], k: number): [number, number, number] =>
  [r, g, b].map((c) => Math.round(k > 0 ? c + (255 - c) * k : c * (1 + k))) as [number, number, number]
const isDark = (hex: string) => {
  const [r, g, b] = rgbOf(hex)
  return 0.299 * r + 0.587 * g + 0.114 * b < 70
}

// ---------------- bodies ----------------
const E = 1.45 // half extent of a sprite, in body units
const G = 144 // zmax grid cells per side
const PPU = 60 // sprite px per body unit
const SIZE = Math.ceil(2 * E * PPU)
const PITCH = 0.45 // how far the camera looks down on the toys
const TURNS = 16
const EYE_UNIT = 0.8 // eye table units to body units
const EYE_UP = 0.3 // eyes sit a little above the middle, like the app's
// Light from the upper left, in front: camera space, y up, z toward the camera.
const LIGHT = (() => {
  const l = [-0.5, 0.7, 0.55]
  const n = Math.hypot(l[0], l[1], l[2])
  return l.map((v) => v / n)
})()

type Solid = { zmax: Float32Array; symmetric: boolean; bottom: number; reach: number }

function insidePoly(poly: Array<[number, number]>, x: number, y: number) {
  let inside = false
  for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
    const [xa, ya] = poly[a]
    const [xb, yb] = poly[b]
    if (ya > y !== yb > y && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside
  }
  return inside
}
function edgeDistance(poly: Array<[number, number]>, x: number, y: number) {
  let best = Infinity
  for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
    const [xa, ya] = poly[b]
    const [xb, yb] = poly[a]
    const dx = xb - xa
    const dy = yb - ya
    const u = Math.max(0, Math.min(1, ((x - xa) * dx + (y - ya) * dy) / (dx * dx + dy * dy || 1)))
    best = Math.min(best, Math.hypot(x - xa - u * dx, y - ya - u * dy))
  }
  return best
}
// Where a horizontal (axis 1) or vertical (axis 0) line at `at` crosses the outline.
function span(poly: Array<[number, number]>, at: number, axis: 0 | 1) {
  let lo = Infinity
  let hi = -Infinity
  const other = axis === 1 ? 0 : 1
  for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
    const pa = poly[a]
    const pb = poly[b]
    if (pa[axis] > at === pb[axis] > at) continue
    const v = pa[other] + ((pb[other] - pa[other]) * (at - pa[axis])) / (pb[axis] - pa[axis])
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  return lo <= hi ? { mid: (lo + hi) / 2, half: (hi - lo) / 2 } : null
}
// How far the outline reaches from the centre along angle a.
function rayReach(poly: Array<[number, number]>, a: number) {
  const dx = Math.cos(a)
  const dy = Math.sin(a)
  let best = 0
  for (let k = 0, j = poly.length - 1; k < poly.length; j = k++) {
    const [x1, y1] = poly[j]
    const [x2, y2] = poly[k]
    const ex = x2 - x1
    const ey = y2 - y1
    const den = dx * ey - dy * ex
    if (Math.abs(den) < 1e-12) continue
    const t = (x1 * ey - y1 * ex) / den
    const u = (x1 * dy - y1 * dx) / den
    if (t > 0 && u >= 0 && u <= 1) best = Math.max(best, t)
  }
  return best
}

const cellOf = (v: number) => ((v + E) / (2 * E)) * (G - 1)
const coordOf = (c: number) => (c / (G - 1)) * 2 * E - E

const solids = new Map<string, Solid>()
function solidOf(name: string): Solid {
  const have = solids.get(name)
  if (have) return have
  const def = SHAPES[name]
  const k = def.size / 1.17
  const build = def.build
  const outlines: Record<string, number[][]> = OUTLINES
  const raw = name === 'sphere' ? null : outlines[name]
  const poly = (raw ?? Array.from({ length: 96 }, (_, n) => [Math.cos((n / 96) * TAU), Math.sin((n / 96) * TAU)])).map(([x, y]): [number, number] => [x * k, y * k])
  const zmax = new Float32Array(G * G).fill(-1)
  const rows = build.kind === 'revolve' ? Array.from({ length: G }, (_, j) => span(poly, coordOf(j), 1)) : []
  const cols = build.kind === 'pill' ? Array.from({ length: G }, (_, i) => span(poly, coordOf(i), 0)) : []
  const reachAt = build.kind === 'loft' ? Array.from({ length: 256 }, (_, n) => rayReach(poly, (n / 256) * TAU)) : []
  for (let j = 0; j < G; j++) {
    const y = coordOf(j)
    for (let i = 0; i < G; i++) {
      const x = coordOf(i)
      let z = -1
      if (build.kind === 'sphere') z = 1 - x * x - y * y >= 0 ? Math.sqrt(1 - x * x - y * y) : -1
      else if (build.kind === 'revolve') {
        const s = rows[j]
        if (s && Math.abs(x - s.mid) <= s.half) z = Math.sqrt(s.half * s.half - (x - s.mid) ** 2)
      } else if (build.kind === 'pill') {
        const s = cols[i]
        if (s && Math.abs(y - s.mid) <= s.half) z = Math.sqrt(s.half * s.half - (y - s.mid) ** 2)
      } else if (insidePoly(poly, x, y)) {
        if (build.kind === 'loft') {
          const a = (Math.atan2(y, x) + TAU) % TAU
          const reach = reachAt[Math.round((a / TAU) * 256) % 256] || 1
          const s = Math.min(1, Math.hypot(x, y) / reach)
          z = build.depth * k * Math.sqrt(Math.max(0, 1 - s ** (2 / 0.72)))
        } else {
          const half = build.half * k
          const bevel = build.bevel * k
          const d = edgeDistance(poly, x, y)
          z = d >= bevel ? half : half - bevel + Math.sqrt(bevel * bevel - (bevel - d) ** 2)
        }
      }
      zmax[j * G + i] = z
    }
  }
  const solid: Solid = {
    zmax,
    symmetric: build.kind === 'sphere' || build.kind === 'revolve',
    bottom: Math.min(...poly.map((p) => p[1])),
    reach: Math.max(...poly.map((p) => Math.hypot(p[0], p[1]))) + 0.05,
  }
  solids.set(name, solid)
  return solid
}

function zAt(s: Solid, x: number, y: number) {
  const fx = cellOf(x)
  const fy = cellOf(y)
  if (fx < 0 || fy < 0 || fx >= G - 1 || fy >= G - 1) return -1
  const i = Math.floor(fx)
  const j = Math.floor(fy)
  const u = fx - i
  const v = fy - j
  const z = s.zmax
  const a = z[j * G + i]
  const b = z[j * G + i + 1]
  const c = z[(j + 1) * G + i]
  const d = z[(j + 1) * G + i + 1]
  // At the outline a corner is outside: use the nearest cell, so edges stay crisp.
  if (a < 0 || b < 0 || c < 0 || d < 0) return z[Math.round(fy) * G + Math.round(fx)]
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v
}

// Camera space (x right, y up, z toward the camera) of a body point at this yaw.
function toCamera(x: number, y: number, z: number, yaw: number): [number, number, number] {
  const xr = x * Math.cos(yaw) + z * Math.sin(yaw)
  const zr = -x * Math.sin(yaw) + z * Math.cos(yaw)
  return [xr, y * Math.cos(PITCH) - zr * Math.sin(PITCH), y * Math.sin(PITCH) + zr * Math.cos(PITCH)]
}

type View = { depth: Float32Array; nx: Float32Array; ny: Float32Array; nz: Float32Array; mask: Uint8Array; top: number }
const views = new Map<string, View>()

// Ray casts the body at this yaw: depth, normal and coverage per sprite pixel.
function viewOf(name: string, turn: number): View {
  const solid = solidOf(name)
  const key = `${name}|${solid.symmetric ? 0 : turn}`
  const have = views.get(key)
  if (have) return have
  const yaw = solid.symmetric ? 0 : (turn / TURNS) * TAU
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const cp = Math.cos(PITCH)
  const sp = Math.sin(PITCH)
  const depth = new Float32Array(SIZE * SIZE).fill(-Infinity)
  const mask = new Uint8Array(SIZE * SIZE)
  const inside = (sx: number, ycam: number, t: number) => {
    const y = ycam * cp + t * sp
    const zr = -ycam * sp + t * cp
    const x = sx * cy - zr * sy
    const z = sx * sy + zr * cy
    const zm = zAt(solid, x, y)
    return zm >= 0 && Math.abs(z) <= zm
  }
  const STEP = 0.03
  let top = SIZE
  for (let py = 0; py < SIZE; py++) {
    const ycam = E - (py + 0.5) / PPU
    for (let px = 0; px < SIZE; px++) {
      const sx = (px + 0.5) / PPU - E
      if (sx * sx + ycam * ycam > solid.reach * solid.reach) continue
      for (let t = solid.reach; t > -solid.reach; t -= STEP) {
        if (!inside(sx, ycam, t)) continue
        let hi = t + STEP
        let lo = t
        for (let n = 0; n < 6; n++) {
          const mid = (hi + lo) / 2
          if (inside(sx, ycam, mid)) lo = mid
          else hi = mid
        }
        depth[py * SIZE + px] = lo
        mask[py * SIZE + px] = 1
        top = Math.min(top, py)
        break
      }
    }
  }
  // Normals from the depth buffer: one formula for every kind of body.
  const nx = new Float32Array(SIZE * SIZE)
  const ny = new Float32Array(SIZE * SIZE)
  const nz = new Float32Array(SIZE * SIZE)
  const d = (x: number, y: number) => (x >= 0 && y >= 0 && x < SIZE && y < SIZE && mask[y * SIZE + x] ? depth[y * SIZE + x] : null)
  const slope = (here: number, a: number | null, b: number | null) => (a !== null && b !== null ? (b - a) / 2 : a !== null ? here - a : b !== null ? b - here : 0)
  for (let py = 0; py < SIZE; py++)
    for (let px = 0; px < SIZE; px++) {
      const at = py * SIZE + px
      if (!mask[at]) continue
      const here = depth[at]
      // Per body unit: d(depth)/dx and d(depth)/dy (y up, so rows go the other way).
      const gx = slope(here, d(px - 1, py), d(px + 1, py)) * PPU
      const gy = -slope(here, d(px, py - 1), d(px, py + 1)) * PPU
      const n = Math.hypot(gx, gy, 1)
      nx[at] = -gx / n
      ny[at] = -gy / n
      nz[at] = 1 / n
    }
  const view: View = { depth, nx, ny, nz, mask, top: E - top / PPU }
  views.set(key, view)
  return view
}

const sprites = new Map<string, HTMLCanvasElement>()
// The body in one colour at one yaw: lit, shaded, highlighted, outlined.
function spriteOf(name: string, color: string, turn: number) {
  const solid = solidOf(name)
  const key = `${name}|${color}|${solid.symmetric ? 0 : turn}`
  const have = sprites.get(key)
  if (have) return have
  const v = viewOf(name, turn)
  const hex = bodyHex(color)
  const dark = isDark(hex)
  const base = rgbOf(hex)
  const lit = mixRgb(base, dark ? 0.12 : 0.22)
  const shade = mixRgb(base, dark ? -0.3 : -0.16)
  const line = mixRgb(base, dark ? -0.6 : -0.42)
  const cv = document.createElement('canvas')
  cv.width = SIZE
  cv.height = SIZE
  const c = cv.getContext('2d')!
  const img = c.createImageData(SIZE, SIZE)
  const OUT = 2 // outline width in sprite px
  const near = (x: number, y: number, here: number) => {
    for (let dy = -OUT; dy <= OUT; dy++)
      for (let dx = -OUT; dx <= OUT; dx++) {
        if (dx * dx + dy * dy > OUT * OUT + 1) continue
        const qx = x + dx
        const qy = y + dy
        if (qx < 0 || qy < 0 || qx >= SIZE || qy >= SIZE) return true
        const q = qy * SIZE + qx
        // The silhouette, and creases where a nearer part overlaps a farther one.
        if (!v.mask[q] || v.depth[q] < here - 0.18) return true
      }
    return false
  }
  for (let py = 0; py < SIZE; py++)
    for (let px = 0; px < SIZE; px++) {
      const at = py * SIZE + px
      if (!v.mask[at]) continue
      const lambert = v.nx[at] * LIGHT[0] + v.ny[at] * LIGHT[1] + v.nz[at] * LIGHT[2]
      const rgb = near(px, py, v.depth[at]) ? line : lambert > 0.93 ? lit : lambert > 0.3 ? base : shade
      img.data.set([rgb[0], rgb[1], rgb[2], 255], at * 4)
    }
  c.putImageData(img, 0, 0)
  sprites.set(key, cv)
  return cv
}

type EyeSpot = { x: number; y: number; ux: number; uy: number; len: number; wide: number }
const eyeSpots = new Map<string, Array<EyeSpot | null>>()
// Where the two eyes are on screen at this yaw, or null when that eye is round the back.
function eyesOf(name: string, turn: number) {
  const key = `${name}|${turn}`
  const have = eyeSpots.get(key)
  if (have) return have
  const solid = solidOf(name)
  const fit = SHAPES[name].eyes
  const v = viewOf(name, turn)
  const yaw = (turn / TURNS) * TAU
  const front = (x: number, y: number) => {
    const z = zAt(solid, x, y)
    return z < 0 ? null : toCamera(x, y, z, yaw)
  }
  const spots = [-1, 1].map((side): EyeSpot | null => {
    const x = (side * fit.gap * EYE_UNIT) / 2
    const y = EYE_UP + fit.lift * EYE_UNIT
    const half = (fit.h * EYE_UNIT) / 2
    const mid = front(x, y)
    const up = front(x, y + half)
    const down = front(x, y - half)
    if (!mid || !up || !down) return null
    const px = Math.round((mid[0] + E) * PPU)
    const py = Math.round((E - mid[1]) * PPU)
    if (px < 0 || py < 0 || px >= SIZE || py >= SIZE) return null
    const at = py * SIZE + px
    // Hidden behind the body, or turned too far away to read.
    if (!v.mask[at] || Math.abs(v.depth[at] - mid[2]) > 0.08 || v.nz[at] < 0.18) return null
    const dx = up[0] - down[0]
    const dy = -(up[1] - down[1])
    const len = Math.hypot(dx, dy)
    return { x: mid[0], y: -mid[1], ux: dx / len, uy: dy / len, len, wide: fit.w * EYE_UNIT * Math.sqrt(Math.max(0.15, 1 - v.nx[at] ** 2)) }
  })
  eyeSpots.set(key, spots)
  return spots
}

const turnOf = (yaw: number) => (((Math.round((yaw / TAU) * TURNS) % TURNS) + TURNS) % TURNS)

export function drawMascot(H: Hand, look: Look, pose: Pose) {
  const c = H.ctx()
  const name = shapeName(look.shape)
  const solid = solidOf(name)
  const turn = turnOf(pose.yaw ?? FACE_YAW[pose.face])
  const view = viewOf(name, turn)
  // Where the bottom middle of the body lands on screen, below the body's centre.
  const ground = -solid.bottom * Math.cos(PITCH)
  const halfWidth = Math.min(1.3, solid.reach)
  const lean = pose.lean + (pose.lying ? (pose.face === 'sw' || pose.face === 'nw' ? 0.4 : -0.4) : 0)

  if (pose.dust !== undefined && pose.dust !== null) {
    const u = pose.dust
    for (const side of [-1, 1]) {
      const P = circ(side * (halfWidth * R * pose.sx + u * 10), -2 - u * 3, 2.5 + u * 3, 10)
      H.tint(P, 'paper', 0.9 * (1 - u), { fine: true })
      H.outline(null, P, 'blue', 0.8, { tone: 0.5 * (1 - u), amp: 0, fine: true })
    }
  }
  // The shadow shrinks while it is in the air.
  const k = Math.max(0.45, 1 - pose.lift / 40)
  H.tint(ell(1, 0.5, halfWidth * R * 0.9 * pose.sx * k, 5 * k, 24), 'blue', 0.28 * k + 0.06, { fine: true })

  c.save()
  // Lean round the ground point, lift, then squash and stretch from the feet.
  c.translate(0, -pose.lift)
  c.rotate(lean)
  c.scale(pose.sx, pose.sy)
  c.imageSmoothingEnabled = true
  c.imageSmoothingQuality = 'high'
  c.drawImage(spriteOf(name, look.color, turn), -E * R, (-ground - E) * R, 2 * E * R, 2 * E * R)
  const hex = bodyHex(look.color)
  drawEyes(c, pose, eyesOf(name, turn), isDark(hex) ? '#f4ead8' : INK, ground)
  c.restore()

  const top = (-ground - view.top) * R * pose.sy
  drawMark(H, pose, Math.sin(lean) * (-top + pose.lift) + (pose.face === 'sw' || pose.face === 'nw' ? -8 : 8), top - pose.lift - 4)
}

function drawEyes(c: CanvasRenderingContext2D, pose: Pose, spots: Array<EyeSpot | null>, ink: string, ground: number) {
  const t = pose.t
  const blink = pose.eyes === 'open' && (t % 4.1 > 3.96 || t % 9.7 > 9.58)
  c.fillStyle = ink
  c.strokeStyle = ink
  c.lineCap = 'round'
  for (const spot of spots) {
    if (!spot) continue
    c.save()
    c.translate(spot.x * R, (spot.y - ground) * R)
    // Local frame: y runs from the eye's bottom to its top, x across it.
    c.rotate(Math.atan2(spot.ux, -spot.uy))
    const len = spot.len * R
    const w = Math.max(1.4, spot.wide * R)
    if (pose.eyes === 'shut' || blink) {
      c.lineWidth = Math.max(1.2, w * 0.45)
      c.beginPath()
      c.arc(0, -len * 0.05, w * 0.85, 0.25, Math.PI - 0.25)
      c.stroke()
    } else if (pose.eyes === 'happy') {
      c.lineWidth = Math.max(1.3, w * 0.5)
      c.beginPath()
      c.arc(0, len * 0.2, w * 0.85, Math.PI + 0.3, TAU - 0.3)
      c.stroke()
    } else {
      const h = pose.eyes === 'wide' ? len * 1.15 : pose.eyes === 'focus' ? len * 0.55 : len
      const ww = pose.eyes === 'wide' ? w * 1.2 : w
      c.beginPath()
      c.roundRect(-ww / 2, -h / 2 + (pose.eyes === 'focus' ? len * 0.2 : 0), ww, h, ww / 2)
      c.fill()
    }
    c.restore()
  }
}

const fine = { fine: true }
const LINE = 'black' as const

function drawMark(H: Hand, pose: Pose, x: number, y: number) {
  const t = pose.t
  if (pose.mark === 'z')
    for (let n = 0; n < 3; n++) {
      const p = (t * 0.35 + n / 3) % 1
      const zx = x + 4 + p * 12 + Math.sin(p * 6) * 2
      const zy = y - p * 24
      const s = 2.4 + p * 2.6
      H.line(
        null,
        [
          [zx - s, zy - s],
          [zx + s, zy - s],
          [zx - s, zy + s],
          [zx + s, zy + s],
        ],
        'blue',
        1.3,
        { tone: 1 - p * 0.7, amp: 0, fine: true },
      )
    }
  if (pose.mark === '!' || pose.mark === '?') {
    const bob = Math.sin(t * 10) * 1.5
    const P = roundRect(x - 6, y - 22 + bob, x + 6, y - 6 + bob, 5, 4)
    H.fill(P, pose.mark === '!' ? 'sun' : 'coral', pose.mark === '!' ? 0.95 : 0.6, fine)
    H.outline(null, P, LINE, 1.3, { tone: 1, amp: 0.1, fine: true })
    if (pose.mark === '!') {
      H.line(null, [[x, y - 19 + bob], [x, y - 12 + bob]], 'black', 2.2, { amp: 0, fine: true })
      H.dot(x, y - 9 + bob, 1.3, 'black', 1, { fine: true })
    } else {
      H.line(null, [...arcPts(x, y - 16 + bob, 3, 3, Math.PI, Math.PI * 2.4, 8), [x, y - 11 + bob]], 'black', 1.8, { amp: 0, fine: true })
      H.dot(x, y - 8.5 + bob, 1.2, 'black', 1, { fine: true })
    }
  }
  if (pose.mark === 'dots') {
    const bx = x + 10
    const by = y - 14
    for (const [cx, cy, r] of [
      [x + 2, y - 2, 1.6],
      [x + 5, y - 6, 2.4],
    ]) {
      const P = circ(cx, cy, r, 10)
      H.fill(P, 'paper', 1, fine)
      H.outline(null, P, LINE, 0.8, { tone: 1, amp: 0, fine: true })
    }
    const B = ell(bx, by, 12, 8, 24)
    H.fill(B, 'paper', 1, fine)
    H.outline(null, B, LINE, 1, { tone: 1, amp: 0.1, fine: true })
    for (let n = 0; n < 3; n++) H.dot(bx + (n - 1) * 4.6, by, 1.3, 'blue', Math.floor(t * 3) % 3 === n ? 1 : 0.35, fine)
  }
  if (pose.mark === 'sparkle')
    for (let n = 0; n < 3; n++) {
      const a = t * 2 + (n * TAU) / 3
      const s = 2.5 + (Math.sin(t * 6 + n) * 0.5 + 0.5) * 2.5
      H.fill(starPts(x + Math.cos(a) * 14, y + 4 + Math.sin(a) * 6, s, s * 0.3, 4, 0), n % 2 ? 'sun' : 'coral', 1, fine)
    }
  if (pose.mark === 'note') {
    const p = (t * 0.6) % 1
    const nx = x + 6 + p * 10
    const ny = y - p * 16
    H.dot(nx, ny, 2.4, 'blue', 1 - p * 0.6, fine)
    H.line(null, [[nx + 2.2, ny], [nx + 2.2, ny - 8], [nx + 6, ny - 6]], 'blue', 1.2, { amp: 0, tone: 1 - p * 0.6, fine: true })
  }
  if (pose.mark === 'sweat') {
    const P = loop([[x - 8, y + 6], [x - 6, y + 2], [x - 4, y + 6], [x - 6, y + 8]], 2)
    H.fill(P, 'teal', 0.5, fine)
    H.outline(null, P, LINE, 0.8, { tone: 1, amp: 0, fine: true })
  }
  if (pose.mark === 'heart') {
    const p = (t * 0.5) % 1
    const hx = x + 4
    const hy = y - p * 14
    const P = loop([[hx, hy + 4], [hx - 5, hy - 1], [hx - 3, hy - 5], [hx, hy - 2], [hx + 3, hy - 5], [hx + 5, hy - 1]], 2)
    H.fill(P, 'coral', 1 - p * 0.5, fine)
  }
}
