# grok-bot-office

https://grokhouse.dev is a website that shows a signed-in user's Grok Bots as mascots in an isometric office, one room per bot, and lets them reply to bots from comic speech bubbles. Vite page + a Cloudflare Worker for `/api/*`. No framework.

## architecture

```
page (src/)                                    Worker (worker/)
main.ts ── /api/office, /api/watch stream ──▶ index.ts ──▶ office.ts ──▶ grok.ts ──▶ Cursor
   │                                             cookie       aggregation   GrokBotService
   ├─ layout.ts       BotSnapshot ▶ RoomPlan (theme, furniture, work spots, free tiles)
   ├─ scene/viewer.ts camera, cached room/thing prints, draws mascots, anchors for the DOM
   ├─ scene/actors.ts mood from Live ▶ tasks (walk, do, bed, wake) ▶ Pose
   ├─ engine/         isometric printing from bot-house + mascot.ts
   └─ ui/hud.ts       room signs, speech bubbles, bot strip, details drawer, toasts
```

- `worker/protocol.ts` holds every `/api/*` response type; the page imports it type-only.
- `state.ts` is the page's one source of truth: every input (office snapshot, stream event, click) is an `OfficeEvent`, folded by the pure `reduce`; what shows is derived (`bubbleOf`, `presenceOf`). Never mirror state in other modules; add an event and derive. Tests: `npx vitest run`.
- Merge rules: feed items upsert by entry ID (higher `updated` wins), live and read state replace only on a newer `at`. A slow snapshot can never undo stream data.
- `engine/press.ts`, `world.ts`, `kinds.ts` are copied from `remorses/bot-house`. Keep their drawing language; furniture is data in `public/kinds.json` (u along the back, v toward the viewer, z up, one unit per tile).
- Moods use wall time (`Date.now()`), tasks and emotes use `performance.now()`.
- Mascots (`engine/mascot.ts`) are small 3D bodies ray cast into cached sprites, one per shape, colour and yaw. Their outlines in `engine/mascot-shapes.json` come from the Grok Bot app; regenerate with `scripts/extract-mascot-shapes.ts`.
- The private API is in `docs/grok-bot-api.md`. The protocol came from `kimakivoice/opencode-grok-bot/src/grok-bot.ts`.

## validating

```bash
pnpm dev --port 5747          # in a tuistory session
playwriter: open http://localhost:5747/?demo for the demo office, / for the signed-in one
pnpm run build                # tsc for page and Worker, then vite build
```

Judge visual changes on a screenshot. When testing with real bots, only send short prompts like "hi".
