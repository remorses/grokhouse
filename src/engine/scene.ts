// A room as a scene: the base (floor, walls, rugs, things on the walls) printed once,
// then the things that stand, back to front, with the bots sorting in among them.

import { streamOf, type Hand, type Rng } from './press.ts'
import { EDGES, drawBulb, drawShell, type Edges } from './world.ts'
import { drawThing, type Kind } from './kinds.ts'
import type { Item, Room } from '../types.ts'

export const kindOf = (kinds: Record<string, Kind>, item: Item): Kind | null => kinds[item.kind] || null
export const layerOf = (kind: Kind) => (kind.place === 'rug' ? 'rug' : kind.place === 'wall' ? 'wall' : 'stand')

// The base: the card, floor, walls, rugs (under the sun patch), and everything hung on the walls.
export function drawBase(
  H: Hand,
  rm: Room,
  items: Item[],
  kinds: Record<string, Kind>,
  images: Record<string, HTMLImageElement | null>,
  o: { edges?: Edges } = {},
) {
  const R: Rng = streamOf('room', rm.id)
  const E = o.edges ?? EDGES
  const flat = items.filter((it) => kindOf(kinds, it) && layerOf(kindOf(kinds, it)!) === 'rug')
  const hung = items.filter((it) => kindOf(kinds, it) && layerOf(kindOf(kinds, it)!) === 'wall')
  drawShell(H, R, rm, {
    edges: E,
    onFloor: () => {
      for (const it of flat) drawThing(H, streamOf('item', it.id), kindOf(kinds, it)!, it, images)
    },
  })
  for (const it of hung) drawThing(H, streamOf('item', it.id), kindOf(kinds, it)!, it, images)
  drawBulb(H, R, rm, true, E)
}
