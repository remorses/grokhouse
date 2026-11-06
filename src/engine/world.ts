// The world: the house is rooms and outdoor spaces, 9 by 9 tiles each, set
// edge to edge on one floor. Each is drawn in its own iso coordinates
// (0..9, 0..9, z up). Its two back edges are j = 0 (side 'ne') and i = 0
// (side 'nw'); its front edges are open, like a dollhouse with the front off.
// A back edge with nothing behind it is the house's outside wall, full height
// (a fence, outdoors); a back edge shared with another space is a low wall
// with a doorway, so you can see into every room.

import {
  isoX,
  isoY,
  lerp,
  loop,
  type Hand,
  type InkName,
  type Rng,
  type Vec,
  rd,
  blob,
  centroid,
  curve,
  ell,
  streamOf,
} from './press.ts'
import type { Color, Item, Room, Side, Walls } from '../types.ts'

export const ROOM = 9 // tiles per side
export const PITCH = 13 // each bot's room is its own box, with a walkway round it
export const WALL_H = 2.6 // a back wall's height in z
export const LOW_H = 0.85 // a wall between two spaces
export const GAP = [3.55, 5.45] // the doorway in every wall between two spaces

export type EdgeKind = 'wall' | 'fence' | 'low' | 'none' | 'join' | 'cut'
export interface Edges {
  ne: EdgeKind
  nw: EdgeKind
  se: EdgeKind
  sw: EdgeKind
  paint?: Record<Side, Walls>
  out?: Record<Side, boolean>
}
export const EDGES: Edges = { ne: 'wall', nw: 'wall', se: 'cut', sw: 'cut' }

export type BoxColor = Color

export interface BoxOptions {
  shadow?: boolean
  shadowTone?: number
  top?: Color | null
  line?: boolean
  lw?: number
  half?: number
  full?: number
  fine?: boolean
}

// ---------------- shadow & light ----------------
// The light is up and to the left; shadows are blue overprint, falling down-right.
export function shadowAt(H: Hand, x: number, y: number, rx: number, ry: number, tone = 0.22) {
  H.tint(ell(x, y, rx, ry), 'blue', tone)
}
export function shadowBox(H: Hand, i: number, j: number, w: number, d: number, z: number, h: number, tone = 0.2) {
  const k = Math.min(h, 2) * 0.45
  H.tint(
    [H.p(i + k, j + k * 0.5, z), H.p(i + w + k, j + k * 0.5, z), H.p(i + w + k, j + d + k * 0.5, z), H.p(i + k, j + d + k * 0.5, z)].map(
      (p) => [p[0] + 4, p[1] + 2] as Vec,
    ),
    'blue',
    tone,
  )
}

// ---------------- the card ----------------
export function slab(H: Hand, R: Rng, rm: Room, E: Edges = EDGES) {
  const w = rm.w
  const d = rm.d
  const th = 0.4
  const top = H.tile(0, 0, w, d, 0)
  const se = H.faceJ(w, 0, d, -th, 0)
  const sw = H.faceI(0, d, w, -th, 0)
  if (E.se === 'cut') {
    H.fill(se, 'blue', 0.62)
    H.line(R, [se[0], se[1], se[2]], 'blue', 1, { tone: 0.85, amp: 0.25 })
  }
  if (E.sw === 'cut') {
    H.fill(sw, 'blue', 0.4)
    H.line(R, [sw[0], sw[3], sw[2]], 'blue', 1, { tone: 0.85, amp: 0.25 })
  }
  H.knock(top)
  return top
}

// ---------------- floors ----------------
export function floorOf(H: Hand, R: Rng, rm: Room, f: Room['floor'] = {}) {
  const w = rm.w
  const d = rm.d
  const P = H.tile(0, 0, w, d, 0)
  const style = f?.style || 'planks'
  const ink = f?.ink || 'sun'
  const tone = f?.tone ?? 0.3
  H.fill(P, ink, tone)
  if (f?.ink2) H.tint(P, f.ink2, f.tone2 ?? 0.12)
  H.clip(P, () => {
    if (style === 'planks') {
      for (let r = 0; r < d / 0.6; r++) {
        const j = r * 0.6
        H.line(R, [H.p(0, j, 0), H.p(w, j, 0)], 'blue', 0.7, { tone: 0.45, amp: 0.12 })
        let i = rd(R, 0, 2.5)
        while (i < w) {
          H.line(R, [H.p(i, j, 0), H.p(i, j + 0.6, 0)], 'blue', 0.7, { tone: 0.4, amp: 0.05 })
          i += rd(R, 2.2, 4.2)
        }
        if (R() < 0.35) H.tint(H.tile(rd(R, 0, w - 3), j, rd(R, 1.5, 3), 0.6, 0), ink, 0.12)
      }
    } else if (style === 'tiles' || style === 'checker') {
      for (let i = 0; i < w; i++)
        for (let j = 0; j < d; j++)
          if (style === 'checker' ? (i + j) % 2 : R() < 0.18) H.tint(H.tile(i, j, 1, 1, 0), f?.ink2 || 'blue', style === 'checker' ? f?.tone2 ?? 0.55 : 0.08)
      for (let i = 0; i <= w; i++) H.line(R, [H.p(i, 0, 0), H.p(i, d, 0)], 'blue', 0.6, { tone: 0.4, amp: 0.05 })
      for (let j = 0; j <= d; j++) H.line(R, [H.p(0, j, 0), H.p(w, j, 0)], 'blue', 0.6, { tone: 0.4, amp: 0.05 })
    } else if (style === 'carpet') {
      H.speckle(R, P, f?.ink2 || 'blue', 900, 0.4, 1, 0.35)
    } else if (style === 'concrete') {
      H.speckle(R, P, 'blue', 260, 0.4, 1.2, 0.3)
      for (let k = 0; k < 4; k++) {
        const a = [rd(R, 1, w - 1), rd(R, 1, d - 1)]
        H.line(
          R,
          curve([H.p(a[0], a[1], 0), H.p(a[0] + rd(R, -1, 1), a[1] + rd(R, 0.5, 1.5), 0), H.p(a[0] + rd(R, -1.5, 1.5), a[1] + rd(R, 1.5, 2.5), 0)], 2),
          'blue',
          0.6,
          { tone: 0.35 },
        )
      }
    } else if (style === 'grass') {
      for (let k = 0; k < 260; k++) {
        const i = rd(R, 0.2, w - 0.2)
        const j = rd(R, 0.2, d - 0.2)
        const [x, y] = H.p(i, j, 0)
        H.line(R, [[x - 2, y + 1], [x - 0.5, y - 4], [x + 1, y + 1]], 'teal', 0.8, { tone: 0.8, amp: 0.1 })
      }
    }
  })
  H.outline(R, P, 'blue', 1, { tone: 0.85, amp: 0.3 })
  return P
}

// ---------------- walls ----------------
export function wallPt(H: Hand, side: Side, pos: number, z: number, off = 0): Vec {
  return side === 'ne' ? H.p(pos, -off, z) : H.p(-off, pos, z)
}
export function wallRect(H: Hand, side: Side, p0: number, p1: number, z0: number, z1: number, off = 0.02): Vec[] {
  return [wallPt(H, side, p0, z0, off), wallPt(H, side, p1, z0, off), wallPt(H, side, p1, z1, off), wallPt(H, side, p0, z1, off)]
}
export function backWalls(H: Hand, R: Rng, rm: Room, o: Walls = {}, sides: Side[] = ['nw', 'ne']) {
  const w = rm.w
  const d = rm.d
  const h = WALL_H
  const ink = o.ink || 'coral'
  const tone = o.tone ?? 0.22
  const style = o.style || 'plain'
  const faces: [Side, Vec[], number, number][] = [
    ['nw', H.faceJ(0, 0, d, 0, h), d, 0.14],
    ['ne', H.faceI(0, 0, w, 0, h), w, 0.04],
  ]
  const out = faces.filter((f) => sides.includes(f[0]))
  for (const [side, F, len, shade] of out) {
    H.fill(F, ink, tone)
    if (o.ink2) H.tint(F, o.ink2, o.tone2 ?? 0.15)
    H.clip(F, () => {
      if (style === 'plank')
        for (let p = 0.7; p < len; p += 0.7) H.line(R, [wallPt(H, side, p, 0), wallPt(H, side, p, h)], 'blue', 0.8, { tone: 0.45, amp: 0.2 })
      if (style === 'stripe')
        for (let p = 0; p < len; p += 1) H.tint(wallRect(H, side, p, p + 0.5, 0, h, 0), o.ink2 || ink, 0.2)
      if (style === 'brick') {
        const rows = Math.round(h / 0.25)
        for (let r = 0; r < rows; r++) {
          const z = (r * h) / rows
          H.line(R, [wallPt(H, side, 0, z), wallPt(H, side, len, z)], 'blue', 0.7, { tone: 0.4, amp: 0.15 })
          for (let p = (r % 2) * 0.4; p < len; p += 0.8) H.line(R, [wallPt(H, side, p, z), wallPt(H, side, p, z + h / rows)], 'blue', 0.7, { tone: 0.4, amp: 0.1 })
        }
      }
      if (style === 'tile') {
        for (let p = 0; p <= len; p += 0.5) H.line(R, [wallPt(H, side, p, 0), wallPt(H, side, p, h * 0.45)], 'blue', 0.6, { tone: 0.35, amp: 0.1 })
        for (let z = 0; z <= h * 0.45; z += 0.5) H.line(R, [wallPt(H, side, 0, z), wallPt(H, side, len, z)], 'blue', 0.6, { tone: 0.35, amp: 0.1 })
        H.line(R, [wallPt(H, side, 0, h * 0.45), wallPt(H, side, len, h * 0.45)], 'blue', 1, { tone: 0.7 })
      }
      if (style === 'dots')
        for (let p = 0.35; p < len; p += 0.7)
          for (let z = 0.35; z < h; z += 0.7) {
            const [x, y] = wallPt(H, side, p + ((z * 1.43) % 1 > 0.5 ? 0.35 : 0), z)
            H.dot(x, y, 1.6, o.ink2 || 'coral', 0.8)
          }
      H.tint(F, 'blue', shade)
      H.grad(F, 'blue', 0.12, 0, wallPt(H, side, len / 2, 0), wallPt(H, side, len / 2, h * 0.45), 6)
    })
  }
  return out
}
export function wallTrim(H: Hand, R: Rng, rm: Room, o: Walls = {}, sides: Side[] = ['nw', 'ne']) {
  const w = rm.w
  const d = rm.d
  const h = WALL_H
  const ink = o.ink || 'coral'
  const tone = o.tone ?? 0.22
  const th = 0.14
  if (sides.includes('nw')) {
    H.fill(wallRect(H, 'nw', 0, d, 0, 0.16, 0.01), 'paper', 1)
    H.tint(wallRect(H, 'nw', 0, d, 0, 0.16, 0.01), 'blue', 0.2)
    H.grad([H.p(0, 0, 0), H.p(1.4, 1.4, 0), H.p(1.4, d, 0), H.p(0, d, 0)], 'blue', 0.22, 0, H.p(0, d / 2, 0), H.p(1.2, d / 2, 0), 5)
    const T = [H.p(0, 0, h), H.p(0, d, h), H.p(-th, d, h), H.p(-th, 0, h)]
    H.fill(T, ink, tone * 0.4)
    H.outline(R, T, 'blue', 1, { tone: 0.9, amp: 0.2 })
    H.outline(R, H.faceJ(0, 0, d, 0, h), 'blue', 1.1, { tone: 0.9, amp: 0.25 })
  }
  if (sides.includes('ne')) {
    H.fill(wallRect(H, 'ne', 0, w, 0, 0.16, 0.01), 'paper', 1)
    H.tint(wallRect(H, 'ne', 0, w, 0, 0.16, 0.01), 'blue', 0.08)
    H.grad([H.p(0, 0, 0), H.p(w, 0, 0), H.p(w, 1.1, 0), H.p(1.1, 1.1, 0)], 'blue', 0.16, 0, H.p(w / 2, 0, 0), H.p(w / 2, 1, 0), 5)
    const T = [H.p(0, 0, h), H.p(w, 0, h), H.p(w, -th, h), H.p(0, -th, h)]
    H.fill(T, ink, tone * 0.4)
    H.outline(R, T, 'blue', 1, { tone: 0.9, amp: 0.2 })
    H.outline(R, H.faceI(0, 0, w, 0, h), 'blue', 1.1, { tone: 0.9, amp: 0.25 })
  }
}
export function lowWall(H: Hand, R: Rng, rm: Room, side: Side, paint: Walls = {}) {
  const len = side === 'ne' ? rm.w : rm.d
  const col: Color = [
    paint.ink || 'coral',
    Math.max(0.12, paint.tone ?? 0.22) + 0.06,
    paint.ink2,
    paint.tone2,
  ] as Color
  const t = 0.07
  for (const [a, b] of [[0, GAP[0]], [GAP[1], len]]) {
    if (side === 'ne') boxAt(H, R, a, -t, b - a, 2 * t, 0, LOW_H, col, { shadow: false, lw: 0.9, top: ['paper', 1] })
    else boxAt(H, R, -t, a, 2 * t, b - a, 0, LOW_H, col, { shadow: false, lw: 0.9, top: ['paper', 1] })
  }
  const F =
    side === 'ne'
      ? [H.p(0, t, 0), H.p(len, t, 0), H.p(len, 0.8, 0), H.p(0.8, 0.8, 0)]
      : [H.p(t, 0, 0), H.p(0.8, 0.8, 0), H.p(0.8, len, 0), H.p(t, len, 0)]
  H.grad(F, 'blue', 0.12, 0, side === 'ne' ? H.p(len / 2, 0, 0) : H.p(0, len / 2, 0), side === 'ne' ? H.p(len / 2, 0.7, 0) : H.p(0.7, len / 2, 0), 4)
}
export function fence(H: Hand, R: Rng, rm: Room, side: Side) {
  const len = side === 'ne' ? rm.w : rm.d
  const white: Color = ['paper', 1]
  const at = (p: number, v: number): Vec => (side === 'ne' ? [p, v] : [v, p])
  for (const z of [0.22, 0.5]) {
    const [i, j] = at(0, -0.03)
    const [w, d] = side === 'ne' ? [len, 0.05] : [0.05, len]
    boxAt(H, R, i, j, w, d, z, 0.07, white, { shadow: false, lw: 0.7, fine: true })
  }
  for (let p = 0.05; p <= len - 0.05; p += 0.45) {
    const [i, j] = at(p, -0.02)
    boxAt(H, R, i, j, side === 'ne' ? 0.09 : 0.06, side === 'ne' ? 0.06 : 0.09, 0, 0.72, white, { shadow: false, lw: 0.7, fine: true })
  }
}

// ---------------- boxes ----------------
// A free-standing box: top, the +j face (half shade) and the +i face (full shade).
export function boxAt(
  H: Hand,
  R: Rng,
  i: number,
  j: number,
  w: number,
  d: number,
  z: number,
  h: number,
  col: Color,
  o: BoxOptions = {},
) {
  const [ink, tone, ink2, tone2] = col
  if (o.shadow !== false && h > 0.05) shadowBox(H, i, j, w, d, z, h, o.shadowTone ?? 0.2)
  const top = H.tile(i, j, w, d, z + h)
  const se = H.faceJ(i + w, j, d, z, z + h)
  const sw = H.faceI(i, j + d, w, z, z + h)
  const paint = (F: Vec[], extra: number) => {
    H.fill(F, ink, tone, o)
    if (ink2) H.tint(F, ink2, tone2!, o)
    if (extra) H.tint(F, 'blue', extra, o)
  }
  paint(sw, o.half ?? 0.18)
  paint(se, o.full ?? 0.4)
  if (o.top) {
    H.fill(top, o.top[0], o.top[1], o)
    if (o.top[2]) H.tint(top, o.top[2], o.top[3], o)
  } else paint(top, 0)
  if (o.line !== false) {
    const lw = o.lw ?? 1
    H.outline(R, top, 'blue', lw, { tone: 0.9, amp: 0.15 })
    H.line(R, [top[3], sw[0], sw[1], se[1], top[2]], 'blue', lw, { tone: 0.9, amp: 0.15 })
    H.line(R, [top[2], sw[1]], 'blue', lw, { tone: 0.9, amp: 0.15 })
  }
  return { top, se, sw }
}

// ---------------- on the walls ----------------
export function windowOn(H: Hand, R: Rng, side: Side, pos: number, z: number, w: number, h: number) {
  const P = wallRect(H, side, pos - w / 2, pos + w / 2, z, z + h, 0.03)
  H.fill(P, 'blue', 0.16)
  H.tint(P, 'teal', 0.12)
  H.clip(P, () => {
    const c = centroid(P)
    const RR = streamOf('window', side, pos)
    cloud(H, RR, c[0] + rd(RR, -10, 10), c[1] - h * 6, 9 + w * 3, 'paper', 1)
    const t = wallPt(H, side, pos + w * 0.3, z, 0.03)
    H.fill(blob(R, t[0], t[1] - 2, 16, 10, 0), 'teal', 0.65)
  })
  H.line(R, [wallPt(H, side, pos, z, 0.04), wallPt(H, side, pos, z + h, 0.04)], 'paper', 2.4, { amp: 0.1 })
  H.line(R, [wallPt(H, side, pos - w / 2, z + h * 0.55, 0.04), wallPt(H, side, pos + w / 2, z + h * 0.55, 0.04)], 'paper', 2.4, { amp: 0.1 })
  H.outline(R, P, 'blue', 1.4, { tone: 0.9, amp: 0.2 })
  const sill = [
    wallPt(H, side, pos - w / 2 - 0.1, z, 0.04),
    wallPt(H, side, pos + w / 2 + 0.1, z, 0.04),
    wallPt(H, side, pos + w / 2 + 0.1, z, 0.24),
    wallPt(H, side, pos - w / 2 - 0.1, z, 0.24),
  ]
  H.fill(sill, 'paper', 1)
  H.outline(R, sill, 'blue', 0.9, { tone: 0.8 })
  return P
}
// The sun through a window: a pale patch on the floor, thrown down-right.
export function sunPatch(H: Hand, _R: Rng, _rm: Room, side: Side, pos: number, w: number) {
  const P =
    side === 'ne'
      ? [H.p(pos - w / 2 + 0.3, 0.15, 0), H.p(pos + w / 2 + 0.3, 0.15, 0), H.p(pos + w / 2 + 1.6, 3.2, 0), H.p(pos - w / 2 + 1.6, 3.2, 0)]
      : [H.p(0.15, pos - w / 2 + 0.2, 0), H.p(0.15, pos + w / 2 + 0.2, 0), H.p(3.4, pos + w / 2 + 1.2, 0), H.p(3.4, pos - w / 2 + 1.2, 0)]
  H.tint(P, 'sun', 0.22)
  return P
}
export function doorOn(H: Hand, R: Rng, side: Side, pos: number, w = 1.1, h = 2.3) {
  const P = wallRect(H, side, pos - w / 2, pos + w / 2, 0, h, 0.03)
  H.fill(P, 'blue', 0.62)
  const inset = wallRect(H, side, pos - w / 2 + 0.15, pos + w / 2 - 0.15, 0.25, h - 0.2, 0.035)
  H.outline(R, inset, 'blue', 0.8, { tone: 0.6, amp: 0.1 })
  H.outline(R, P, 'blue', 1.3, { tone: 0.95 })
  const k = wallPt(H, side, pos + w * 0.3, h * 0.46, 0.05)
  H.dot(k[0], k[1], 1.6, 'sun', 1, { knock: true })
  const mat = side === 'nw' ? H.tile(0.05, pos - 0.6, 0.7, 1.2, 0.01) : H.tile(pos - 0.6, 0.05, 1.2, 0.7, 0.01)
  H.fill(mat, 'coral', 0.45)
  H.outline(R, mat, 'blue', 0.8, { tone: 0.7 })
  return P
}
// The room's one bare bulb, hung from a hook at the top of a wall.
export function bulbOn(H: Hand, R: Rng, side: Side, pos: number, lit = true) {
  const top = wallPt(H, side, pos, WALL_H, 0.02)
  const at = wallPt(H, side, pos, WALL_H - 1.05, 0.5)
  H.line(
    R,
    curve([top, [lerp(top[0], at[0], 0.55) + 2, lerp(top[1], at[1], 0.4)], [at[0], at[1] - 6]], 2),
    'black',
    0.9,
    { amp: 0.1 },
  )
  if (lit) H.glow(at[0], at[1] + 2, 26, 22, 'sun', 0.5)
  H.fill(
    [
      [at[0] - 2, at[1] - 7],
      [at[0] + 2, at[1] - 7],
      [at[0] + 2, at[1] - 3],
      [at[0] - 2, at[1] - 3],
    ],
    'black',
    0.9,
  )
  const g = ell(at[0], at[1] + 1, 4, 4.6)
  H.fill(g, 'sun', lit ? 0.55 : 0.1)
  H.outline(R, g, 'blue', 0.8, { tone: 0.9, amp: 0.05 })
  return at
}
export function outletOn(H: Hand, R: Rng, side: Side, pos: number) {
  const P = wallRect(H, side, pos - 0.12, pos + 0.12, 0.35, 0.62, 0.02)
  H.fill(P, 'paper', 1)
  H.outline(R, P, 'blue', 0.8, { tone: 0.8, amp: 0.05 })
  const c = centroid(P)
  H.dot(c[0] - 1, c[1] - 2, 0.6, 'blue', 1)
  H.dot(c[0] + 1, c[1] + 2, 0.6, 'blue', 1)
}

// ---------------- things ----------------
export function cloud(H: Hand, R: Rng, x: number, y: number, s: number, ink: InkName = 'paper', tone = 1) {
  const P: Vec[] = []
  for (let k = 0; k < 7; k++) {
    const t = (k / 6) * Math.PI
    P.push([x - s + (k * s * 2) / 6, y - s * 0.4 - Math.sin(t) * s * 0.55 - rd(R, 0, s * 0.15)])
  }
  P.push([x + s, y], [x - s, y])
  const Q = loop(P, 2)
  H.fill(Q, ink, tone)
  H.outline(R, Q, 'blue', 0.9, { tone: 0.7, amp: 0.4 })
  return Q
}
export function twinkle(H: Hand, _R: Rng, x: number, y: number, s: number, ink: InkName = 'sun', tone = 1) {
  H.fill(
    [
      [x, y - s],
      [x + s * 0.22, y - s * 0.22],
      [x + s, y],
      [x + s * 0.22, y + s * 0.22],
      [x, y + s],
      [x - s * 0.22, y + s * 0.22],
      [x - s, y],
      [x - s * 0.22, y - s * 0.22],
    ],
    ink,
    tone,
  )
}

// ---------------- the room ----------------
export function drawShell(H: Hand, R: Rng, rm: Room, o: { edges?: Edges; onFloor?: () => void } = {}) {
  const E = o.edges || EDGES
  const full = (['nw', 'ne'] as Side[]).filter((sd) => E[sd] === 'wall')
  const on = (x?: { side: Side } | null) => !!(x && full.includes(x.side))
  slab(H, R, rm, E)
  floorOf(H, R, rm, rm.floor || {})
  if (o.onFloor) o.onFloor()
  const wall = rm.walls || {}
  if (full.length) {
    backWalls(H, R, rm, wall, full)
    for (const win of (rm.windows || []).filter(on)) windowOn(H, R, win.side, win.pos, win.z ?? 1.1, win.w ?? 2, win.h ?? 1.4)
    if (on(rm.door)) doorOn(H, R, rm.door!.side, rm.door!.pos)
    for (const ot of (rm.outlets || []).filter(on)) outletOn(H, R, ot.side, ot.pos)
    wallTrim(H, R, rm, wall, full)
  }
  for (const sd of ['ne', 'nw'] as Side[]) {
    if (E[sd] === 'low') lowWall(H, R, rm, sd, (E.paint && E.paint[sd]) || wall)
    if (E[sd] === 'fence') fence(H, R, rm, sd)
  }
  for (const win of (rm.windows || []).filter(on)) sunPatch(H, R, rm, win.side, win.pos, win.w ?? 2)
}
export function drawBulb(H: Hand, R: Rng, rm: Room, lit: boolean, E: Edges = EDGES) {
  if (rm.bulb && E[rm.bulb.side] === 'wall') bulbOn(H, R, rm.bulb.side, rm.bulb.pos, lit)
}

// Where a room's card sits in the house, in world px.
export const roomOrigin = (at: [number, number]): Vec => [isoX(at[0] * PITCH, at[1] * PITCH), isoY(at[0] * PITCH, at[1] * PITCH, 0)]
// The region a room's drawing can cover, in the room's own px.
export function roomBounds(rm: Room) {
  const w = rm.w
  const d = rm.d
  return { x0: isoX(0, d) - 30, y0: -WALL_H * 32 - 40, x1: isoX(w, 0) + 30, y1: isoY(w, d, 0) + 30 }
}

export type { Item }
