// The scene's data model: rooms and the things in them. kinds.json is fetched at
// runtime; rooms and items come from layout.ts, one room per bot.

import type { InkName, Rng, Vec } from './engine/press.ts'

export type Face = 'ne' | 'nw' | 'se' | 'sw'
export type Side = 'ne' | 'nw'
export type Place = 'floor' | 'surface' | 'wall' | 'rug'

export interface Swatch {
  0: InkName
  1: number
  2?: InkName
  3?: number
}
export type Color = [InkName, number] | [InkName, number, InkName, number]

export interface At {
  i: number
  j: number
  z?: number
  face?: Face
}

export interface Item {
  id: string
  kind: string
  name: string
  room: string
  at: At
  colors?: Record<string, string>
  options?: Record<string, string | number>
  size?: [number, number]
  image?: string
}

export interface Floor {
  style?: 'planks' | 'tiles' | 'checker' | 'carpet' | 'concrete' | 'grass'
  ink?: InkName
  tone?: number
  ink2?: InkName
  tone2?: number
}

export interface Walls {
  ink?: InkName
  tone?: number
  style?: 'plain' | 'plank' | 'brick' | 'tile' | 'dots' | 'stripe'
  ink2?: InkName
  tone2?: number
}

export interface Room {
  id: string
  type: string
  name: string
  at: [number, number]
  w: number
  d: number
  walls?: Walls
  floor?: Floor
  windows?: { side: Side; pos: number; w?: number; h?: number; z?: number }[]
  outlets?: { side: Side; pos: number }[]
  bulb?: { side: Side; pos: number }
  door?: { side: Side; pos: number }
  outdoor?: boolean
}

// A kind: the shapes that make one piece of furniture, in its own space.
// u runs along its back, v comes out towards you, z goes up; one unit is one tile.
export interface ShapeFields {
  box?: number[]
  legs?: number[]
  cyl?: number[]
  cone?: number[]
  ball?: number[]
  pole?: number[]
  panel?: number[]
  plant?: number[]
  books?: number[]
  flat?: number[]
  glow?: number[]
  lines?: number[][]
  dot?: number[]
  // [u, v, z, r]: clock hands on a wall-facing plane, set by item.options.hour / minute
  hands?: number[]
  color?: string
  color2?: string
  top?: string
  size?: number
  style?: string
  pattern?: string
  shadow?: boolean
  soft?: boolean
  open?: boolean
  round?: boolean
  drop?: boolean
  frame?: string
  inset?: number
  shine?: boolean
  art?: string
  image?: string
  line?: boolean
  thick?: number
  inset0?: number
  w?: number
  r?: number
  tone?: number
  dash?: boolean
  fine?: boolean
}

export interface Kind {
  name: string
  label: string
  place: Place
  size: [number, number]
  height?: number
  // Wall things: how high they hang by default.
  z?: number
  price?: [number, number]
  colors?: Record<string, string>
  options?: Record<string, string | number>
  shapes?: ShapeFields[]
  shadow?: boolean
  fine?: boolean
  solid?: boolean
  against?: boolean
  reach?: { l?: number; t?: number; r?: number; b?: number }
}

export type Kinds = Record<string, Kind>

// A thing's own space mapped onto the room's tiles.
export interface Placer {
  nw: boolean
  flip: boolean
  W: (u: number, v: number, z: number) => Paul3
  rect: (u: number, v: number, w: number, d: number) => [number, number, number, number]
  size: (w: number, d: number) => [number, number]
}
export type Paul3 = [number, number, number]

// A drawing context the shape printers use.
export interface ThingCtx {
  pl: Placer
  col: (name: string) => Color
  item: Item
  kind: Kind
  images: Record<string, HTMLImageElement | null>
  fine: boolean
  lw?: number
}

export type { Vec, Rng, InkName }
