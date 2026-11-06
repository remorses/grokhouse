// What /api/* answers. Shared by the Worker and the page (type-only imports).

export type BotInfo = {
  id: string
  name: string
  description: string | null
  // The avatar the Grok Bot app shows: a shape ("blob", "pebble", "hex", ...) and a colour name.
  shape: string
  color: string
  isGroup: boolean
  createdAt: number | null
}

// What a bot does right now (GrokBotAgentLiveState). `at` orders updates.
export type Live = {
  at: number
  running: boolean
  composing: boolean
  retrying: boolean
  // `{ kind: "tool", tool, detail }` while a tool runs, `{ kind: "thinking" }` otherwise.
  activity: { kind: string; tool: string | null; detail: string | null } | null
  // Set while the bot waits for the user (a card, a shared tab).
  awaiting: string | null
  subagents: boolean
}

// The account's read state of a bot (GrokBotAgentClientState), shared by every client:
// reading a bot in the desktop app hides its bubble here, and the other way round.
export type ReadState = {
  at: number
  lastViewedAt: number | null
  lastActivityAt: number | null
  lastEntryId: string | null
  unread: number
}

export type CardOption = { label: string; value: string; description: string | null }
export type Card =
  | { type: 'choice'; entryId: string; prompt: string; options: CardOption[]; multi: boolean }
  | { type: 'approval'; entryId: string; requestId: string; flavor: 'auto-review' | 'local-tool'; title: string; detail: string }
  | { type: 'grant'; entryId: string; requestId: string; app: string }

export type FeedItem = {
  id: string
  // Transcript order, and the change counter: an edited entry (a streaming message, an
  // answered card) comes again with a higher `updated`.
  seq: number
  updated: number
  at: number
  who: 'user' | 'bot' | 'other'
  // text: chat message; tool: an app tool call; event: automation changes and notices
  kind: 'text' | 'tool' | 'event' | 'file' | 'card'
  text: string
  tool: string | null
  app: string | null
  card: Card | null
}

export type Automation = {
  id: string
  name: string
  prompt: string
  // "Every day around 9:00 AM", or the trigger type when the app gives no description.
  when: string
  trigger: string
  enabled: boolean
  nextRunAt: number | null
  lastRunAt: number | null
  lastStatus: string | null
  runs: number
}

export type Todo = { id: string; text: string; status: 'todo' | 'doing' | 'done' | 'cancelled' }

// Where a bot's transcript stream resumes: the transcript generation and the highest
// `updated` seen. A cleared transcript starts a new generation.
export type Cursor = { generation: number; seq: number }

export type BotSnapshot = {
  bot: BotInfo
  live: Live
  read: ReadState
  cursor: Cursor
  automations: Automation[]
  todos: Todo[]
  feed: FeedItem[]
  // Apps and tools seen in the recent transcript, most used first.
  tools: string[]
}

export type OfficeSnapshot = { email: string | null; at: number; bots: BotSnapshot[] }
export type FeedSnapshot = { at: number; feed: FeedItem[]; todos: Todo[]; cursor: Cursor }

// /api/watch: one JSON per server-sent event, from WatchGrokBotTranscripts.
export type WatchEvent =
  | { type: 'connected'; at: number }
  | { type: 'heartbeat'; at: number }
  // New or changed transcript entries. `omitted`: some were too big to inline; reload the feed.
  | { type: 'rows'; botId: string; generation: number; items: FeedItem[]; deleted: string[]; seq: number; omitted: boolean }
  | { type: 'live'; botId: string; live: Live }
  | { type: 'read'; botId: string; read: ReadState }
  // A bot was added, removed or changed: reload the office.
  | { type: 'roster'; botId: string }
  // The transcript was cleared, or the cursor is too old to resume: reload that bot's feed.
  | { type: 'reset'; botId: string }
  | { type: 'end'; error: string | null }
export type Me = { signedIn: boolean; email: string | null }

export type CardReply = { entryId: string; value: string }
