# Development & architecture

This guide covers Argdown interchange, the source layout, the local API, tests, privacy and data flow, and the known limits of the current beta.

[Back to README](../README.md) · [Using Agora](using-agora.md) · [Judging](judging.md) · [Providers & models](providers.md)

## Running from source

Requirements: **Node 22.12+** and npm. The project is developed on Node 26.

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. For a production-style run:

```bash
npm run build
npm start
```

`npm start` serves the built client and API from one Node process. The server binds to `127.0.0.1` by default. Set `HOST=0.0.0.0` only if you deliberately want to expose it on your network; the API has no authentication and is intended for a single-user machine.

To build the Windows installer from source, run `npm run dist`. This produces `release/Agora-Setup-<version>.exe` and an NSIS blockmap. The installer bundles Electron and the compiled server, so users do not need Node. `npm run electron` runs the desktop shell directly; `npm run pack` produces an unpacked build for inspection.

The app works before you connect a model. It seeds two reference debates on first run, and the local scaffolder can still author maps, clearly labelled as a scaffold. A connected model makes the arguments topic-specific.

## Argdown

Argdown is the interchange format, not a side export. `Export` gives you the source and a `.argdown` download. Relations are written **underneath the node they apply to**, which is how the official parser reads them:

```argdown
[Cities should fund night buses]: Cities should fund a dense network of night buses.
  + <Night workers need it>
  - <The demand is too thin>

<Night workers need it>: Hospitals, kitchens and warehouses run through the night.

(1) Hundreds of thousands of people finish work after midnight.
(2) Taxis are unaffordable for a large share of those workers.
----
(3) A city that runs at night needs a public way home.
```

The exporter writes argument definitions and their relations in branch-first order, then assigns each argument's reasoning as a native premise-conclusion structure (`(1) … ---- (3) …`). The graph is not grouped by Case view inside the file, and the PCS survives a round trip through the official parser.

The map is capped at **42 nodes**, each argument at **520 characters**, and the chamber history at **80 messages**. When a model response or import reaches a cap, the UI reports what was shortened instead of dropping content silently. A debate file that cannot be parsed is skipped and named in a library warning; it is never overwritten by the store.

`Import` accepts a paste or a file (`.argdown`, `.ad`, `.md`, `.txt`). It uses `@argdown/core`'s parser and model builder, reports syntax errors with line numbers, and refuses prose that contains no argument structure. A blank motion title falls back to the document's first heading/claim.

Round-trip verified: **16-node reference map → Argdown → import → same 16 nodes, 16 relations, and native premise-conclusion structures** (`src/server/argdown-import.test.ts`).

## How it is put together

```
src/
  core/                 pure domain layer — no DOM, no network, no filesystem
    model.ts            Debate/Node/Edge types, reconciliation, prompt cleanup
    argdown.ts          Debate → Argdown serializer
    layout.ts           deterministic case/thread graph layouts
    stage.ts            seeded branch-walk staging + speaker narration
    judgment.ts         pure link assessments, grounded propagation, deterministic solver, summary, Markdown report
    edit.ts             pure draft graph editing: content, responses, relations, connectivity guards
    link-context.ts     target role and shortest path to the thesis for a link prompt
    demo.ts             two hand-authored reference debates
  server/
    index.ts            server entry, Vite middleware in dev, static dist in prod
    routes.ts           REST API (below)
    store.ts            JSON debate store + first-run seeding
    atomic-write.ts     non-destructive file replacement with retry/backup
    settings.ts         provider settings, environment fallbacks, public key status
    local-access.ts     loopback Host/Origin guard for the local API
    provider-test.ts    timeout-bounded provider connection test
    provider-models.ts  model discovery for OpenAI-compatible, Claude, and Gemini
    anthropic.ts        native Claude Messages transport and thinking mapping
    gemini.ts           native Gemini generateContent transport and thinking mapping
    llm.ts              intake/extension prompts, zod validation, local fallback
    judge.ts            per-link model assessment, clustering call, local structural fallback
    openrouter-catalog.ts cached OpenRouter reasoning capability metadata
    judgment-store.ts   saves compact frozen map views and judge run records alongside a debate
    argdown-import.ts   Argdown → Debate using @argdown/core
  shared/
    provider-url.ts     base URL normalization and provider URL validation
    provider-protocol.ts native endpoint and auth-protocol selection
    thinking.ts         thinking capability and provider wire mappings
    judge-progress.ts   shared judge progress events, concurrency, and ETA estimate
  ui/
    App.tsx             workspace, library, chamber, stage controller, judgment controller, draft editor state
    components/         DebateGraph, ChatPanel, StagePanel, NodeInspector, MapEditor, JudgmentModal, JudgmentPanel, Modals
    styles.css          editorial paper / library ink / shared stage
    dark.css            Night Reading Room — warm dark palette
    aurora.css          Aurora — twilight chrome
    light.css           Editorial paper — daylight stage
    editor.css          map editor panel and draft controls
```

The domain layer is shared by server and browser. The graph layout and staging algorithm are deterministic given a seed, so the same map stages identically in a test and in the browser.

The theme is applied before paint by `public/theme-init.js`. Production builds serve it from the app itself so the Content-Security-Policy can forbid inline scripts.

### API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | liveness and provider readiness |
| `GET` | `/api/debates` | library summaries; includes warnings for unreadable files |
| `POST` | `/api/debates` | author from `{ text }` |
| `GET` | `/api/debates/:id` | full debate |
| `PATCH` | `/api/debates/:id` | save an edited graph from `{ motion, thesisText, nodes, edges }`; rejects a missing motion, stranded nodes, or relations between nodes that are not in the map |
| `DELETE` | `/api/debates/:id` | remove |
| `GET` | `/api/debates/:id/argdown` | download source |
| `POST` | `/api/debates/:id/chat` | answer a question about the map from `{ text }`; no map edits |
| `POST` | `/api/debates/:id/judge` | `{ standard, strictness, model?, stream? }` → judgment run; `stream: true` returns NDJSON progress events ending in the run |
| `GET` | `/api/debates/:id/judgments` | saved-run summaries and the current map fingerprint |
| `POST` | `/api/debates/:id/judgments` | `{ run }` → save a completed run with a frozen map view |
| `GET` | `/api/debates/:id/judgments/:runId` | open a saved run and its frozen map; `stale` reports whether the live map has changed |
| `DELETE` | `/api/debates/:id/judgments/:runId` | remove a saved run |
| `POST` | `/api/import` | `{ source, motion? }` |
| `GET`/`PUT` | `/api/settings` | provider settings (key never returned) |
| `POST` | `/api/settings/test` | model-list check, then a tiny completion; 15-second limit |

## Tests and checks

```bash
npm test          # vitest: core domain, server routes, providers, judgment, Argdown
npm run typecheck # tsc --noEmit
npm run build     # vite production build
```

## Privacy and data flow

- Debates and settings live in `data/`, which is gitignored in a source checkout. In the packaged app the same files live under `%APPDATA%\Agora\data`.
- API keys are stored server-side only. The browser receives `hasKey: true/false`; the key is never included in an API response or written to `agora.log`.
- The desktop build stores settings as plain JSON and keeps them after uninstall. Use a key you can rotate; use **Forget saved key** in Settings before handing the machine on.
- **When you connect a model, the motion, argument map, chat messages, and judgment context you submit are sent directly to the provider you configure.** There is no remote Agora service, account, proxy, or cloud sync. The provider's terms, retention policy, and jurisdiction govern that data; do not paste confidential material unless you accept that.
- The local scaffolder and a local OpenAI-compatible provider configured through **Custom** keep model work on this machine. The packaged app forces the local API to `127.0.0.1`.
- There is **no telemetry, analytics, crash reporting, or auto-update**. The app does not phone home.
- The desktop renderer is sandboxed with context isolation and a production Content-Security-Policy. It denies permission requests and keeps navigation inside the local app; the only external link (Argdown's site) opens in the default browser.
- There is no authentication on the local API. It is intended for a single-user machine; do not expose it to a network you do not trust.
- The optional **Read turns aloud** control uses the browser's speech-synthesis voices. Agora does not record or upload audio. Whether the browser synthesizes speech locally or through a network-backed voice depends on the browser and installed voice engine.

See [`SECURITY.md`](../SECURITY.md) for the current beta's security limitations, including the unsigned build and the packaged Electron version.

## Limits, honestly

- The **local scaffolder** produces a structurally useful map, not a topic-specific debate. Connect a model for actual arguments.
- The **local bench** is a structural demonstration, not a substantive judgment. Connect a model for real rulings.
- The bench judges the arguments **as written on the record**. It does not retrieve sources or establish factual truth; `✓ Proved` is a procedural finding, not a fact-check.
- Judgment is **one clustering call plus one model call per argument link** and is not cached; a map with many replies can take a while and cost accordingly.
- A judgment run lives in the browser session as a sidecar unless you explicitly save it. Saved runs survive reloads and map edits through the frozen map view; exporting the Markdown report remains a separate option.
- Authoring and chamber responses are non-streaming. Judgment progress is streamed, but the model's ruling text is still delivered as part of the assessment rather than token by token.
- Staging is a textual performance with an optional browser voice, not audio mixing or avatars.
- The chamber can answer general questions from the selected model's training knowledge, but it does not browse or retrieve live web data.
- Single-user, stored locally. Model calls go to the provider you configure; there is no authentication, collaboration, or cloud sync.
- Argdown import is graph-first. Formatting details that have no graph meaning are not preserved.
- The Windows beta is unsigned, Windows x64 only, and has no auto-update or dedicated website. Provider compatibility is focused on current model IDs; older or retired models and some **Max** thinking settings may fail or time out. xAI/Grok has not been live-tested. The packaged Electron version has upstream security advisories; see `SECURITY.md`.

## Why the name

The agora was the public square where a city argued with itself. The interface is deliberately editorial: warm paper, serif headings, walnut for the motion, olive for the support and rust for the challenge, and a stage that follows the light: dark wood at night, daylight paper by day. Aurora keeps that structure while moving the light to a deep indigo reading room with rose, lilac and periwinkle chrome. The map is the argument; the stage is the argument being made; the bench is the argument being judged.
