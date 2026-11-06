# Grok Bot Office

Watch your **Grok Bots** at work in a cozy little isometric office, and talk to them.

Every bot gets its own room. Busy bots hop between their desks, idle ones potter about, and the rest nap in bed. A bot's last message pops up as a comic speech bubble: close it with the ✕, or type in it to send the bot a prompt.

```bash
pnpm install
pnpm dev            # http://localhost:5173, the Worker runs inside Vite
pnpm run build      # tsc for page and Worker, then vite build
```

Signed out, the page shows a demo office. Open `/?demo` to see it while signed in.

## What it shows

| in the office | from the Grok Bot API |
| --- | --- |
| bot asleep in bed, Zzz | not running, no activity for 90 s |
| bot hopping between work spots | `live.running` with a tool `activity` |
| thought bubble, pacing | running, thinking |
| bot waving with a "?" | `live.awaiting`: it waits for you |
| speech bubble, answer buttons | latest transcript message, pending choice or approval card |
| wall clock hands, ⏰ chip | next automation run (`nextRunAt`) |
| calendar and alarm clock | the bot has automations |
| sticky notes on the corkboard | the bot's todo list |
| room theme | words in its name, description, schedules and the apps it used |

Room themes: lobby (the primary bot), shop (prices, deals), lab (QA, tests), calls (phone, SMS), studio (X, social), library (SEO, research), dev (code, repos) and a cozy den for the rest.

Soft sound effects play when you send a message, when a bot answers, starts working or waits for you, and keys clack quietly while bots work. The 🔊 button mutes them.

## Architecture

```
browser                             Cloudflare Worker (/api/*)        Cursor backend
┌────────────────────────────┐     ┌─────────────────────────┐      ┌──────────────────┐
│ main.ts  polling, actions  │────▶│ worker/index.ts router  │─────▶│ api2.cursor.sh   │
│ layout.ts  bot ▶ room plan │     │  tokens in HttpOnly     │      │  GrokBotService  │
│ scene/viewer.ts  canvas    │     │  cookie, auto refresh   │      │  /auth/poll      │
│ scene/actors.ts  moods     │     │ worker/office.ts        │      │  /oauth/token    │
│ engine/*  isometric print  │     │  snapshot aggregation   │      └──────────────────┘
│ ui/hud.ts  signs, bubbles  │     │ worker/grok.ts  client  │
└────────────────────────────┘     └─────────────────────────┘
```

The page loads `/api/office` once, then keeps one live stream open (`/api/watch`, the app's own `WatchGrokBotTranscripts`). It carries new messages, live state and read state from every client, and roster changes, so new bots appear without a reload.

A bot's bubble shows while its last message is **unread** for your account. Closing it marks the bot read, so it is read in the Grok Bot app too, and reading it in the app hides it here.

The isometric engine (`src/engine/`) comes from bot-house (private repo `remorses/bot-house`): rooms and furniture are data (`public/kinds.json`), printed once into cached canvases. The mascots are drawn live every frame.

## Sign-in

Grok Bot has no public API. The Worker uses Cursor's browser sign-in (the same one the Cursor CLI uses), then calls the private `aiserver.v1.GrokBotService` that the Grok Bot desktop app uses. Choose **Continue with Grok** on Cursor's page if your bots live on your Grok account. Cursor can change or block this at any time.

The private API is documented in [docs/grok-bot-api.md](docs/grok-bot-api.md).

## Deploy

```bash
pnpm run deploy     # build, then wrangler deploy (static assets + Worker)
```
