// Writes src/engine/mascot-shapes.json: the outline of every Grok Bot avatar shape, taken
// from the Grok Bot desktop app's own shape code so the mascots match the app exactly.
//
//   app.asar ──▶ dist/renderer/assets/index.eager-common-*.js
//     `var L=114.2705` … `qs=…`   path builders (pebble, cloud, hex, …), heart points
//     `function Lc(){…}`         the flower, built from seven circles
//   ──▶ run them ──▶ outlines in -1..1, y up ──▶ resampled to POINTS points each
//
// Usage: npx @electron/asar extract "/Applications/Grok Bot.app/Contents/Resources/app.asar" out
//        npx tsx scripts/extract-mascot-shapes.ts out

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const POINTS = 128
const OUT = new URL('../src/engine/mascot-shapes.json', import.meta.url)
const PATH_SHAPES = ['cloud', 'square', 'sparkle', 'clover', 'house', 'star6', 'hex', 'tablet', 'pebble', 'bean', 'egg', 'squircle', 'capsule', 'cylinder', 'gem', 'shield', 'dome', 'arch', 'leaf']

const root = process.argv[2]
if (!root) throw new Error('Pass the extracted app.asar folder, e.g. `npx tsx scripts/extract-mascot-shapes.ts out`')
const assets = path.join(root, 'dist/renderer/assets')
const file = fs.readdirSync(assets).find((name) => name.startsWith('index.eager-common-') && name.endsWith('.js'))
if (!file) throw new Error(`No index.eager-common-*.js in ${assets}`)
const code = fs.readFileSync(path.join(assets, file), 'utf8')

function between(start: string, end: string) {
  const a = code.indexOf(start)
  const b = code.indexOf(end, a)
  if (a < 0 || b < 0) throw new Error(`Marker not found: ${a < 0 ? start : end}. The app changed; update the markers.`)
  return code.slice(a, b)
}

const builders = between('var L=114.2705', 'qs=(e,t)=>Vs(ps(130,3,[t,e,e],-Math.PI/2))') + 'qs=(e,t)=>Vs(ps(130,3,[t,e,e],-Math.PI/2));'
const flower = between('function Lc(){', 'function Rc(')
const sandbox: Record<string, unknown> = {}
vm.runInNewContext(`${builders}\nvar Js=Math.PI*2;\n${flower}\nout={L,z,Gs,Ks,qs,Lc,os};`, sandbox)
type Fns = {
  L: number
  z: (shape: string) => Array<[number, number]>
  Gs: (d: string) => Array<[number, number]>
  Ks: (a: number, b: number) => { path: string }
  qs: (a: number, b: number) => { path: string }
  Lc: () => Array<{ x: number; y: number }>
  os: Array<{ x: number; y: number }>
}
const app = sandbox.out as Fns

// App path space is 0..2L with y down; the mascot code wants -1..1 with y up.
const norm = (points: Array<[number, number]>) => points.map(([x, y]): [number, number] => [(x - app.L) / app.L, -(y - app.L) / app.L])

function resample(points: Array<[number, number]>) {
  const lengths = [0]
  for (let n = 1; n <= points.length; n++) {
    const [ax, ay] = points[n - 1]
    const [bx, by] = points[n % points.length]
    lengths.push(lengths[n - 1] + Math.hypot(bx - ax, by - ay))
  }
  const total = lengths[points.length]
  const out: Array<[number, number]> = []
  let seg = 0
  for (let k = 0; k < POINTS; k++) {
    const at = (k / POINTS) * total
    while (lengths[seg + 1] < at) seg++
    const u = (at - lengths[seg]) / (lengths[seg + 1] - lengths[seg] || 1)
    const [ax, ay] = points[seg]
    const [bx, by] = points[(seg + 1) % points.length]
    out.push([Math.round((ax + (bx - ax) * u) * 1000) / 1000, Math.round((ay + (by - ay) * u) * 1000) / 1000])
  }
  return out
}

const shapes: Record<string, Array<[number, number]>> = {}
for (const name of PATH_SHAPES) shapes[name] = resample(norm(app.z(name)))
shapes.teardrop = resample(norm(app.Gs(app.Ks(88, 48).path)))
shapes.wedge = resample(norm(app.Gs(app.qs(60, 80).path)))
shapes.starFlower = resample(app.Lc().map((p): [number, number] => [p.x, p.y]))
shapes.heartChubby = resample(app.os.map((p): [number, number] => [p.x, p.y]))

fs.writeFileSync(OUT, JSON.stringify(shapes) + '\n')
console.error(`wrote ${Object.keys(shapes).length} shapes to ${OUT.pathname}`)
