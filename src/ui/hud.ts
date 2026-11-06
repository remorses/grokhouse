// Everything on top of the canvas: room signs, speech bubbles, the bot strip, the
// details drawer, the top bar and toasts. Plain DOM; positions follow the camera every
// frame through viewer.anchors().

import { mkHand } from '../engine/press.ts'
import { drawMascot, type Look, type Pose } from '../engine/mascot.ts'
import type { Mood } from '../scene/actors.ts'
import type { Sound } from '../sound.ts'
import type { Bot, Bubble, Presence, Sent } from '../state.ts'
import type { Card } from '../../worker/protocol.ts'

export type Viewer = {
  anchors: (botId: string) => { head: { x: number; y: number; visible: boolean }; sign: { x: number; y: number; visible: boolean }; zoom: number } | null
  mood: (botId: string) => Mood | null
  focus: (botId: string) => void
  fit: () => void
  zoomBy: (step: number) => void
  poke: (botId: string) => void
}

export type Actions = {
  select: (botId: string | null) => void
  send: (botId: string, text: string) => Promise<boolean>
  answer: (botId: string, card: Card, value: string) => Promise<boolean>
  interrupt: (botId: string) => Promise<void>
  // ✕ on a bubble: marks the bot read (for every client) and hides the bubble.
  closeBubble: (botId: string) => void
  // The "…" nub: shows a read message again, on this page only.
  openBubble: (botId: string, entryId: string) => void
  signIn: () => void
  signOut: () => void
}

// One bot as the HUD shows it, derived from the state (state.ts).
export type BotView = { bot: Bot; presence: Presence; bubble: Bubble | null; pending: Sent | null }
export type View = {
  mode: 'demo' | 'live'
  email: string | null
  bots: BotView[]
  selected: string | null
  signingIn: { url: string } | null
}

// ---------------- small helpers ----------------
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}, ...children: Array<Node | string | null | false | undefined>) {
  const node = document.createElement(tag)
  const { class: className, ...rest } = props
  if (className) node.className = className
  Object.assign(node, rest)
  for (const child of children) if (child) node.append(child)
  return node
}

function put(node: Element, ...children: Array<Node | string | null | false | undefined>) {
  node.replaceChildren(...children.filter((child): child is Node | string => Boolean(child)))
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

// Bot messages are markdown; a bubble shows bold, code and line breaks, links as text.
function richText(text: string) {
  return escapeHtml(text.trim())
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^#+\s*/gm, '')
    .replace(/\n{2,}/g, '<br><br>')
    .replace(/\n/g, '<br>')
}

export function ago(at: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}
function inFuture(at: number, now = Date.now()) {
  const s = Math.max(0, Math.round((at - now) / 1000))
  if (s < 60) return 'in a moment'
  if (s < 3600) return `in ${Math.round(s / 60)}m`
  if (s < 86400) return `in ${Math.round(s / 3600)}h`
  return `in ${Math.round(s / 86400)}d`
}

const MOOD_LABEL: Record<Mood, string> = { sleep: 'sleeping', idle: 'just finished', think: 'thinking', work: 'working', wait: 'needs you' }

export function statusOf(mood: Mood | null, live: Presence | undefined) {
  if (!mood || !live) return { label: '', detail: '' }
  if (mood === 'work' && live.activity?.tool) return { label: tidyTool(live.activity.tool), detail: live.activity.detail ?? '' }
  if (mood === 'wait') return { label: 'needs you', detail: live.awaiting ?? '' }
  if (mood === 'idle' && live.lastActivityAt) return { label: 'just finished', detail: ago(live.lastActivityAt) }
  return { label: MOOD_LABEL[mood], detail: '' }
}

// "SetStatus" is the bot telling what it does; other tool names read better spaced out.
function tidyTool(tool: string) {
  if (tool === 'SetStatus') return 'working'
  return tool.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase()
}

const portraitCache = new Map<string, string>()
// A still of the mascot, as a data URL so many chips can share it.
export function portrait(look: Look, size = 68) {
  const key = `${look.shape}|${look.color}|${size}`
  const have = portraitCache.get(key)
  if (have) return have
  const cv = document.createElement('canvas')
  cv.width = size * 2
  cv.height = size * 2
  const c = cv.getContext('2d')!
  const k = (size * 2) / 46
  c.setTransform(k, 0, 0, k, size, size * 2 - 7 * k)
  const pose: Pose = { t: 1, face: 'se', sx: 1, sy: 1, lean: 0, lift: 0, eyes: 'open', mark: null }
  drawMascot(mkHand(c, { seed: 3 }), look, pose)
  const url = cv.toDataURL()
  portraitCache.set(key, url)
  return url
}
function portraitImg(look: Look, size: number) {
  const img = el('img', { src: portrait(look, size), alt: '', width: size, height: size })
  img.style.width = `${size / 2}px`
  img.style.height = `${size / 2}px`
  return img
}

export function createHud({ layer, topbar, strip, drawer, toasts, viewer, sound, actions }: { layer: HTMLElement; topbar: HTMLElement; strip: HTMLElement; drawer: HTMLElement; toasts: HTMLElement; viewer: Viewer; sound: Sound; actions: Actions }) {
  let view: View | null = null
  const signs = new Map<string, HTMLElement>()
  // `open`: the bubble's text is expanded ("more"). Pure DOM state, like a scroll position.
  const bubbles = new Map<string, { node: HTMLElement; key: string; content: string; open: boolean }>()
  const nubs = new Map<string, HTMLElement>()
  const chips = new Map<string, HTMLElement>()
  let drawerKey = ''
  let drawerFor: string | null = null

  // ---------------- top bar ----------------
  const brandMascot = el('img', { src: portrait({ shape: 'blob', color: 'black' }, 92), alt: '' })
  brandMascot.style.cssText = 'width:46px;height:46px;border-radius:12px;background:#ffd23f;border:1.5px solid #2a2228'
  const brandSub = el('p')
  const brand = el('div', { class: 'brand' }, brandMascot, el('div', {}, el('h1', { textContent: 'Grok Bot Office' }), brandSub))
  const account = el('span', { class: 'account' })
  const muteLabel = (muted: boolean) => (muted ? 'Turn sounds on' : 'Mute sounds')
  const mute = el('button', {
    class: 'btn icon',
    title: muteLabel(sound.muted()),
    ariaLabel: muteLabel(sound.muted()),
    textContent: sound.muted() ? '🔇' : '🔊',
    onclick: () => {
      const muted = sound.toggle()
      mute.textContent = muted ? '🔇' : '🔊'
      mute.title = muteLabel(muted)
      mute.ariaLabel = muteLabel(muted)
    },
  })
  const tools = el(
    'div',
    { class: 'tools' },
    account,
    mute,
    el('button', { class: 'btn icon', title: 'Zoom in', textContent: '+', onclick: () => viewer.zoomBy(1) }),
    el('button', { class: 'btn icon', title: 'Zoom out', textContent: '−', onclick: () => viewer.zoomBy(-1) }),
    el('button', { class: 'btn', title: 'See every room', onclick: () => (actions.select(null), viewer.fit()) }, '⤢', el('span', { class: 'label', textContent: 'Whole office' })),
  )
  topbar.append(brand, tools)
  let signin: HTMLElement | null = null

  function renderTop(v: View) {
    const working = v.bots.filter((b) => ['work', 'think'].includes(viewer.mood(b.bot.bot.id) ?? '')).length
    const asleep = v.bots.filter((b) => viewer.mood(b.bot.bot.id) === 'sleep').length
    brandSub.textContent = `${v.bots.length} bots · ${working} at work · ${asleep} asleep${v.mode === 'demo' ? ' · demo' : ''}`
    put(account, 
      v.mode === 'live'
        ? el('button', { class: 'btn', title: v.email ?? '', textContent: 'Sign out', onclick: () => actions.signOut() })
        : el('button', { class: 'btn primary', textContent: 'Sign in', onclick: () => actions.signIn() }),
    )
    const wantCard = v.mode === 'demo'
    if (!wantCard) {
      signin?.remove()
      signin = null
      return
    }
    const card =
      signin ??
      (() => {
        const node = el('div', { class: 'signin' })
        document.body.append(node)
        return node
      })()
    signin = card
    const key = v.signingIn ? `wait:${v.signingIn.url}` : 'idle'
    if (card.dataset.key === key) return
    card.dataset.key = key
    put(card, 
      el('span', { class: 'pill tag', textContent: 'demo office' }),
      el('h2', { textContent: 'Your Grok Bots, at work' }),
      el('p', { textContent: 'Every bot gets a room. Busy bots hop between their desks, idle ones nap. Reply in a bubble to send a bot a message.' }),
      v.signingIn
        ? el(
            'div',
            { class: 'wait' },
            'Approve the sign-in in the Cursor tab that opened. ',
            el('a', { href: v.signingIn.url, target: '_blank', rel: 'noopener', textContent: 'Open it again' }),
          )
        : el(
            'div',
            { class: 'row' },
            el('button', { class: 'btn primary', textContent: 'Sign in with Grok Bot', onclick: () => actions.signIn() }),
            el('button', { class: 'btn ghost', textContent: 'Keep looking', onclick: () => (card.style.display = 'none') }),
          ),
    )
  }

  // ---------------- room signs ----------------
  function renderSigns(v: View) {
    const ids = new Set(v.bots.map((b) => b.bot.bot.id))
    for (const [id, node] of signs) if (!ids.has(id)) (node.remove(), signs.delete(id))
    for (const { bot: b, presence } of v.bots) {
      const id = b.bot.id
      let node = signs.get(id)
      if (!node) {
        node = el('div', { class: 'plaque', onclick: () => actions.select(id) })
        layer.append(node)
        signs.set(id, node)
      }
      const mood = viewer.mood(id)
      const status = statusOf(mood, presence)
      const next = b.automations.filter((a) => a.enabled && a.nextRunAt).sort((a, z) => a.nextRunAt! - z.nextRunAt!).at(0)
      const sched = next ? `⏰ ${inFuture(next.nextRunAt!)}` : b.automations.length ? `⚡ ${b.automations.length} trigger${b.automations.length > 1 ? 's' : ''}` : ''
      const key = JSON.stringify([b.bot.name, mood, status, sched, v.selected === id])
      if (node.dataset.key === key) continue
      node.dataset.key = key
      node.className = `plaque is-${mood ?? 'sleep'}${v.selected === id ? ' is-selected' : ''}`
      const schedTitle = b.automations.map((a) => `${a.name}: ${a.when}`).join('\n')
      put(node, 
        el('div', { class: 'board', textContent: b.bot.name }),
        el(
          'div',
          { class: 'status' },
          el('span', { class: 'pill', title: status.detail }, el('span', { class: 'dot' }), status.detail && mood === 'work' ? `${status.label}: ${status.detail}` : status.label),
          sched ? el('span', { class: 'pill sched', title: schedTitle, textContent: sched }) : null,
        ),
      )
    }
  }

  // ---------------- bubbles ----------------
  function renderBubbles(v: View) {
    for (const { bot: b, bubble: content } of v.bots) {
      const id = b.bot.id
      const have = bubbles.get(id)
      if (!content || !content.visible) {
        have?.node.remove()
        bubbles.delete(id)
        if (!content) {
          nubs.get(id)?.remove()
          nubs.delete(id)
        } else if (nubs.get(id)?.dataset.key !== content.key) {
          nubs.get(id)?.remove()
          const label = `Show ${b.bot.name}'s last message`
          const nub = el('button', { class: 'nub', title: label, ariaLabel: label, onclick: () => actions.openBubble(id, content.key) }, el('span', { textContent: '…' }))
          nub.dataset.key = content.key
          layer.append(nub)
          nubs.set(id, nub)
        }
        continue
      }
      nubs.get(id)?.remove()
      nubs.delete(id)
      const selected = v.selected === id
      const card = content.card
      const busyKey = JSON.stringify([content.key, content.text, selected, card?.entryId ?? null, content.unread, have?.open ?? false])
      if (have && have.key === busyKey) continue
      const fresh = !have || have.content !== content.key
      const node = have?.node ?? el('div')
      const open = have?.open ?? false
      node.className = `bubble${selected ? ' is-selected' : ''}${content.mine ? ' is-mine' : ''}${card ? ' is-card' : ''}${open ? ' is-open' : ''}${content.text.length < 120 ? ' is-short' : ''}${fresh ? ' bubble-in' : ''}`
      const input = el('input', { placeholder: `Reply to ${b.bot.name}…`, maxLength: 4000 })
      const form = el(
        'form',
        {
          onsubmit: async (e: Event) => {
            e.preventDefault()
            const text = input.value.trim()
            if (!text) return
            input.disabled = true
            const ok = await actions.send(id, text)
            input.disabled = false
            if (ok) input.value = ''
          },
        },
        input,
        el('button', { class: 'btn sun', type: 'submit', textContent: 'Send' }),
      )
      const textNode = el('div', { class: 'text', innerHTML: richText(content.text) })
      const more = content.text.length > 160 ? el('button', { class: 'more', textContent: open ? 'less' : 'more', onclick: () => (bubbles.get(id)!.open = !open, render()) }) : null
      put(
        node,
        el('div', { class: 'who' }, el('span', { textContent: content.mine ? 'you' : b.bot.name }), el('span', { textContent: `· ${ago(content.at)}` }), content.unread ? el('span', { class: 'new', textContent: 'new' }) : null),
        textNode,
        more,
        card ? cardButtons(id, card) : null,
        content.mine ? el('div', { class: 'note', textContent: `Sent. ${b.bot.name} will answer here.` }) : null,
        form,
        el('button', {
          class: 'close',
          title: content.unread ? 'Mark read and close' : 'Close',
          ariaLabel: 'Close',
          textContent: '✕',
          onclick: (e: Event) => {
            e.stopPropagation()
            actions.closeBubble(id)
          },
        }),
      )
      node.onpointerdown = (e) => e.stopPropagation()
      if (!have) layer.append(node)
      bubbles.set(id, { node, key: busyKey, content: content.key, open })
      if (fresh) setTimeout(() => node.classList.remove('bubble-in'), 700)
    }
    const ids = new Set(v.bots.map((b) => b.bot.bot.id))
    for (const [id, bubble] of bubbles) if (!ids.has(id)) (bubble.node.remove(), bubbles.delete(id))
    for (const [id, nub] of nubs) if (!ids.has(id)) (nub.remove(), nubs.delete(id))
  }

  function cardButtons(botId: string, card: Card) {
    const buttons =
      card.type === 'choice'
        ? card.options.map((o) => ({ label: o.label, value: o.value }))
        : [
            { label: card.type === 'grant' ? 'Allow' : 'Approve', value: 'approve' },
            { label: 'Always', value: 'always' },
            { label: card.type === 'grant' ? 'Skip' : 'Deny', value: 'deny' },
          ]
    return el(
      'div',
      { class: 'choices' },
      ...buttons.map((b) => {
        const button = el('button', {
          class: 'btn',
          textContent: b.label,
          onclick: async () => {
            button.disabled = true
            await actions.answer(botId, card, b.value)
            button.disabled = false
          },
        })
        return button
      }),
    )
  }

  // ---------------- strip ----------------
  function renderStrip(v: View) {
    const ids = new Set(v.bots.map((b) => b.bot.bot.id))
    for (const [id, node] of chips) if (!ids.has(id)) (node.remove(), chips.delete(id))
    v.bots.forEach(({ bot: b, presence, bubble }, n) => {
      const id = b.bot.id
      let node = chips.get(id)
      if (!node) {
        node = el('button', { class: 'chip', onclick: () => actions.select(view?.selected === id ? null : id) })
        chips.set(id, node)
      }
      if (strip.children[n] !== node) strip.insertBefore(node, strip.children[n] ?? null)
      const mood = viewer.mood(id)
      const status = statusOf(mood, presence)
      const unread = Boolean(bubble?.unread)
      const key = JSON.stringify([b.bot.name, b.bot.shape, b.bot.color, mood, status.label, v.selected === id, unread])
      if (node.dataset.key === key) return
      node.dataset.key = key
      node.className = `chip is-${mood ?? 'sleep'}${v.selected === id ? ' is-selected' : ''}${unread ? ' is-unread' : ''}`
      node.title = `${b.bot.name}: ${status.label}`
      put(node, portraitImg(b.bot, 68), el('span', { class: 'text' }, el('span', { class: 'name', textContent: b.bot.name }), el('span', { class: 'state' }, el('span', { class: 'dot' }), status.label)))
    })
  }

  // ---------------- drawer ----------------
  const composerInput = el('textarea', { rows: 1, placeholder: 'Ask this bot something…', maxLength: 4000 })
  const composerSend = el('button', { class: 'btn primary', type: 'submit', textContent: 'Send' })
  const composer = el(
    'form',
    {
      class: 'composer',
      onsubmit: async (e: Event) => {
        e.preventDefault()
        const text = composerInput.value.trim()
        if (!text || !drawerFor) return
        composerSend.disabled = true
        const ok = await actions.send(drawerFor, text)
        composerSend.disabled = false
        if (ok) composerInput.value = ''
      },
    },
    composerInput,
    composerSend,
  )
  composerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      composer.requestSubmit()
    }
  })
  const drawerHead = el('header')
  const drawerBody = el('div', { class: 'body' })
  drawer.append(drawerHead, drawerBody, composer)
  drawer.addEventListener('pointerdown', (e) => e.stopPropagation())

  function renderDrawer(v: View) {
    const selected = v.bots.find((x) => x.bot.bot.id === v.selected) ?? null
    drawer.classList.toggle('is-open', Boolean(selected))
    if (!selected) {
      drawerFor = null
      drawerKey = ''
      return
    }
    const { bot: b, presence: live, pending } = selected
    const id = b.bot.id
    const mood = viewer.mood(id)
    const key = JSON.stringify([b, mood, live, pending])
    if (key === drawerKey) return
    drawerKey = key
    if (drawerFor !== id) composerInput.placeholder = `Ask ${b.bot.name} something…`
    drawerFor = id
    const status = statusOf(mood, live)
    put(drawerHead, 
      portraitImg(b.bot, 128),
      el('div', {}, el('h2', { textContent: b.bot.name }), el('p', { textContent: b.bot.description || 'No description yet.' })),
      el('button', { class: 'btn icon ghost x', title: 'Close', ariaLabel: 'Close details', textContent: '✕', onclick: () => actions.select(null) }),
    )
    const nowCard = el(
      'div',
      { class: `now is-${mood ?? 'sleep'}` },
      el('span', { class: 'dot' }),
      el('div', { class: 'what' }, status.label, status.detail ? el('small', { textContent: status.detail }) : null),
      live?.running ? el('button', { class: 'btn', textContent: 'Stop', title: 'Interrupt the current run', onclick: () => actions.interrupt(id) }) : null,
      mood === 'sleep' ? el('button', { class: 'btn', textContent: 'Poke', title: 'Wake it up for a second (it does not run anything)', onclick: () => viewer.poke(id) }) : null,
    )
    const schedules = b.automations.length
      ? b.automations.map((a) =>
          el(
            'div',
            { class: 'card' },
            el('div', { class: 'title', textContent: `${a.enabled ? '⏰' : '💤'} ${a.name}` }),
            el(
              'div',
              { class: 'meta' },
              el('span', { textContent: a.when }),
              a.nextRunAt ? el('span', { textContent: `next ${inFuture(a.nextRunAt)}` }) : null,
              a.lastRunAt ? el('span', { textContent: `last ${ago(a.lastRunAt)}${a.lastStatus ? ` (${a.lastStatus})` : ''}` }) : null,
              a.runs ? el('span', { textContent: `${a.runs} runs` }) : null,
            ),
          ),
        )
      : [el('div', { class: 'empty', textContent: 'No schedules. Ask the bot to "do this every morning" to add one.' })]
    const todos = b.todos.length
      ? b.todos.map((t) => el('div', { class: `todo ${t.status}` }, el('span', { class: 'box', textContent: t.status === 'done' ? '✓' : t.status === 'doing' ? '•' : '' }), el('span', { textContent: t.text })))
      : [el('div', { class: 'empty', textContent: 'Nothing on its list.' })]
    const timeline = b.feed.length
      ? b.feed.map((item) =>
          item.kind === 'tool'
            ? el('div', { class: 'tl-tool' }, `🔧 ${item.text}`, el('time', { textContent: ago(item.at) }))
            : el('div', { class: `msg ${item.who === 'user' ? 'user' : 'bot'}`, title: new Date(item.at).toLocaleString() }, el('span', { innerHTML: richText(item.kind === 'event' ? `*${item.text}*` : item.text) }), el('time', { textContent: ago(item.at) })),
        )
      : [el('div', { class: 'empty', textContent: 'No messages yet.' })]
    // Until the transcript has the prompt, show it here as sending.
    const echoed = pending && b.feed.some((item) => item.who === 'user' && item.at >= pending.at - 60_000 && item.text.trim() === pending.text.trim())
    if (pending && !echoed) timeline.push(el('div', { class: 'msg user' }, pending.text, el('time', { textContent: 'sending…' })))
    put(drawerBody, 
      el('section', {}, nowCard),
      el('section', {}, el('h3', { textContent: 'Schedules' }), ...schedules),
      el('section', {}, el('h3', { textContent: 'Todo list' }), ...todos),
      el('section', {}, el('h3', { textContent: 'Recent' }), el('div', { class: 'timeline' }, ...timeline)),
    )
    drawerBody.scrollTop = drawerBody.scrollHeight
  }

  function render() {
    if (!view) return
    renderTop(view)
    renderSigns(view)
    renderBubbles(view)
    renderStrip(view)
    renderDrawer(view)
  }

  // Bubbles trail their bot a little, like they are on a string.
  const trail = new Map<string, { x: number; y: number }>()
  const FOLLOW = 0.22

  // Signs and bubbles follow the camera every frame.
  function place() {
    if (!view) return
    for (const { bot: b } of view.bots) {
      const id = b.bot.id
      const anchor = viewer.anchors(id)
      if (!anchor) continue
      const scale = Math.max(window.innerWidth < 700 ? 0.5 : 0.62, Math.min(1, anchor.zoom * 1.25))
      const sign = signs.get(id)
      if (sign) {
        sign.style.display = anchor.sign.visible ? '' : 'none'
        sign.style.transform = `translate(${Math.round(anchor.sign.x)}px, ${Math.round(anchor.sign.y)}px) translate(-50%, -100%) scale(${scale})`
      }
      const bubble = bubbles.get(id)?.node
      if (bubble) {
        // Trail the bot's move inside its room; the room itself moves with the camera at once.
        const rel = { x: anchor.head.x - anchor.sign.x, y: anchor.head.y - anchor.sign.y }
        const last = trail.get(id) ?? rel
        // Settle exactly once close, so a resting bubble stops moving (and stays easy to click).
        const ease = (from: number, to: number) => (Math.abs(to - from) < 0.5 ? to : from + (to - from) * FOLLOW)
        const eased = { x: ease(last.x, rel.x), y: ease(last.y, rel.y) }
        trail.set(id, eased)
        const p = { x: anchor.sign.x + eased.x, y: anchor.sign.y + eased.y }
        bubble.style.display = anchor.head.visible ? '' : 'none'
        bubble.style.transform = `translate(${Math.round(p.x - 18)}px, ${Math.round(p.y - 16)}px) translate(0, -100%) scale(${scale})`
        bubble.style.zIndex = view.selected === id ? '3' : '1'
      }
      const nub = nubs.get(id)
      if (nub) nub.style.transform = `translate(${Math.round(anchor.head.x - 46)}px, ${Math.round(anchor.head.y - 8)}px) scale(${scale})`
    }
  }

  return {
    update(next: View) {
      view = next
      render()
    },
    // Moods change inside the viewer between updates; refresh the labels now and then.
    tick: render,
    place,
    toast(text: string, bad = false) {
      const node = el('div', { class: `toast${bad ? ' bad' : ''}`, textContent: text })
      toasts.append(node)
      setTimeout(() => node.remove(), bad ? 6000 : 3200)
    },
  }
}
