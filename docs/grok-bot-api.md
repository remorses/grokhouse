---
title: Grok Bot private API
description: The GrokBotService calls the office uses, their request bodies and the response fields that matter.
---

# Grok Bot private API

All calls are Connect JSON: `POST https://api2.cursor.sh/aiserver.v1.GrokBotService/<Method>` with `connect-protocol-version: 1`, `authorization: Bearer <access token>`, `x-cursor-client-type: sand`, `x-cursor-client-version: 0.78.5`, `x-sand-box-namespace: prod`. Enums use their full proto names. Unknown body fields make the backend reject the call.

The method list and message shapes come from the desktop app: `app.asar` ▶ `dist/electron-main/proto.cjs`, where every message has a compact descriptor like `ListGrokBotAgentTasksRequest|1 agent_id 9|2 include_recently_done 8?`.

```bash
npx @electron/asar extract "/Applications/Grok Bot.app/Contents/Resources/app.asar" out
rg -o 'static \$\(\)\{return\["[^"]+"' out/dist/electron-main/proto.cjs
```

## Login

```
cursor.com/loginDeepControl?challenge=<S256>&uuid=<uuid>&mode=login&redirectTarget=cli
  ──▶ user approves ──▶ GET api2.cursor.sh/auth/poll?uuid&verifier ──▶ { accessToken, refreshToken }
POST api2.cursor.sh/oauth/token { client_id, grant_type: refresh_token, refresh_token } ──▶ { access_token }
```

`/auth/poll` answers 404 until the user approves. A Grok-account token has `sub: grok|user_…` and no `email`.

## Calls the office makes

| method | body | what we read |
| --- | --- | --- |
| `ListGrokBotAgents` | `{}` | `agents[]`: `agentId`, `name`, `description`, `avatarShape`, `avatarColor`, `kind` |
| `ListGrokBotAgentStatuses` | `{ agentIds }` | `live`: `isRunning`, `isComposingMessage`, `activity { kind, tool, detail }`, `awaiting { reason }`, `hasRunningSubagents`; `client`: `lastEntryId`, `lastMessagePreview`, `lastActivityAtMs`, `unreadCount` |
| `ListGrokBotAccountAutomations` | `{ timeZone, agentIds }` | `agents[].automations[].recordJson`: `name`, `prompt`, `trigger`, `triggerDescription`, `isEnabled`, `nextRunAt`, `lastRunAt`, `runs[]` |
| `ListGrokBotTranscriptEntries` | `{ agentId, limit }` | `entries[].body`: base64 JSON entry, sort by `seq` |
| `ListGrokBotAgentTodos` | `{ agentId }` | `todos[]`: `content`, `status` (`TODO_STATUS_*`) |
| `SendGrokBotUserMessage` | `{ agentId, messageId, text, sentAtMs, composedAtMs, source, initiator, sendSource }` | `delivery` |
| `InterruptGrokBotAgentRun` | `{ agentId, reason: "user_interrupt" }` | |
| `RespondGrokBotWidget`, `ResolveGrokBot*` | see `worker/office.ts` `answerCard` | `refusal` |

Transcript entry kinds seen: `message` (user prompt, `richText` is a ProseMirror doc), `send-message` (bot text, files, cards), `mcp-app` (an app tool call: `serverName`, `toolName`, `toolArgumentsJson`), `event` (`automation-changed`), `spend-initiation`, `feedback`. Shell and browser tool calls never reach the transcript: only the live `activity` shows them while they run.

## Live stream

`WatchGrokBotTranscripts` is server streaming (Connect: `application/connect+json`, every message enveloped as 1 flag byte + 4 byte length + JSON, flag 2 on the last). Body `{ cursors: [{ agentId, generation, afterUpdatedSeq, sessionId: "" }], inlineBodyMaxBytes }`. Frames are a oneof:

| frame | what it carries |
| --- | --- |
| `connected` | stream ID, `absoluteLifetimeMs` (about 15 to 20 minutes, then reconnect) |
| `agentState` | `live[]` and `client[]` (read state: `lastViewedAtMs`, `unreadCount`); `snapshot: true` first |
| `rows` | new or edited transcript entries after each cursor (`seq`, `updatedSeq`, base64 `body`), `deletes` |
| `rosterChanged` | a bot was added, removed or changed |
| `cleared`, `cursorTooOld` | resync that bot's transcript |
| `heartbeat` | every 10 s |

`SetGrokBotAgentClientState { agentId, markRead: true }` marks a bot read for the account (the app does this when you open a chat).

`ListGrokBotAgentRoutines` answers 404 on the temporal harness; schedules come from `ListGrokBotAccountAutomations`. Other read methods worth trying later: `ListGrokBotAgentTasks`, `ListGrokBotSubagents`, `ListGrokBotAgentSkills`, `GetGrokBotAgentAnalytics`, `ListGrokBotAgentFiles`, `WatchGrokBotTranscripts` (streaming).
