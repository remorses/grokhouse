// Sound effects: soft, low, warm. Files in public/sounds (CC0, see CREDITS.md there),
// played through Web Audio so the same cue can overlap and change pitch per bot.
//
//   send   whoosh when you send a message      reply  marimba when a bot answers
//   needs  two marimba notes: a bot waits      wake   wood block when a bot starts a run
//   tap    wood tap on clicks                  page   paper flick when a bubble closes
//   key    keystrokes while bots work, in little bursts
//
// Browsers only start audio after a click or key press; until then cues are dropped.
// Muting is a page preference kept in localStorage, not office state.

export type Cue = 'send' | 'reply' | 'needs' | 'wake' | 'tap' | 'page' | 'key'

const CUES: Record<Cue, number> = { send: 0.5, reply: 0.55, needs: 0.6, wake: 0.35, tap: 0.35, page: 0.4, key: 0.16 }
const MASTER = 0.8
const MUTED_KEY = 'gbo:muted'
// Typing: a burst of a few keys, then a pause; more working bots, shorter pauses.
const KEY_GAP_MS: [number, number] = [70, 150]
const BURST_KEYS: [number, number] = [3, 7]
const PAUSE_MS: [number, number] = [1800, 4500]

const between = ([lo, hi]: [number, number]) => lo + Math.random() * (hi - lo)

export function createSound() {
  let ctx: AudioContext | null = null
  let out: GainNode | null = null
  let muted = localStorage.getItem(MUTED_KEY) === '1'
  const buffers = new Map<Cue, AudioBuffer>()
  let typists = 0
  let typingTimer = 0

  async function load(context: AudioContext) {
    await Promise.all(
      (Object.keys(CUES) as Cue[]).map(async (cue) => {
        const res = await fetch(`/sounds/${cue}.mp3`).catch(() => null)
        const data = res?.ok ? await res.arrayBuffer() : null
        const buffer = data ? await context.decodeAudioData(data).catch(() => null) : null
        if (buffer) buffers.set(cue, buffer)
      }),
    )
  }

  // The first gesture creates and resumes the audio context.
  function unlock() {
    if (!ctx) {
      ctx = new AudioContext()
      out = ctx.createGain()
      out.gain.value = muted ? 0 : MASTER
      out.connect(ctx.destination)
      void load(ctx)
    }
    if (ctx.state === 'suspended') void ctx.resume()
  }
  for (const type of ['pointerdown', 'keydown'] as const) window.addEventListener(type, unlock, { capture: true })

  // `pitch` in semitones; `volume` scales the cue's own level.
  function play(cue: Cue, { pitch = 0, volume = 1 }: { pitch?: number; volume?: number } = {}) {
    const buffer = buffers.get(cue)
    if (muted || !ctx || !out || !buffer || ctx.state !== 'running') return
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = 2 ** (pitch / 12)
    const gain = ctx.createGain()
    gain.gain.value = CUES[cue] * volume
    source.connect(gain).connect(out)
    source.start()
  }

  function typeBurst() {
    typingTimer = 0
    if (typists <= 0) return
    const keys = Math.round(between(BURST_KEYS))
    let at = 0
    for (let n = 0; n < keys; n++) {
      at += between(KEY_GAP_MS)
      setTimeout(() => play('key', { pitch: between([-2, 2]), volume: between([0.6, 1]) }), at)
    }
    typingTimer = window.setTimeout(typeBurst, at + between(PAUSE_MS) / Math.min(2, typists))
  }

  return {
    play,
    // How many bots are typing right now; 0 stops the keystrokes.
    setTypists(count: number) {
      typists = count
      if (count > 0 && !typingTimer) typingTimer = window.setTimeout(typeBurst, between(PAUSE_MS) / 2)
    },
    muted: () => muted,
    toggle() {
      muted = !muted
      localStorage.setItem(MUTED_KEY, muted ? '1' : '0')
      if (out && ctx) out.gain.setTargetAtTime(muted ? 0 : MASTER, ctx.currentTime, 0.05)
      if (!muted) play('tap')
      return muted
    },
  }
}

export type Sound = ReturnType<typeof createSound>
