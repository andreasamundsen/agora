# Agora — a debate harness

> Every argument has a shape. Find it, then argue with it.

Agora turns a position into a map of arguments, lets you interrogate that map, exports it as **Argdown**, stages the debate as a sequence of turns with a live camera on the graph, and then **convenes a bench** to judge it: a model assesses each argument link locally, deterministic code aggregates the case, and the map shows arguments falling, surviving, or returning until the motion stands or falls.

It is built in the spirit of a learning harness: the model is not there to agree with you. It builds the strongest case for your position, the strongest case against it, and the places where the two actually collide.

## Status

Agora is an early public beta. The source is available under the **MIT License**. The Windows build is intentionally unsigned, has no auto-update, and has no dedicated website yet. Gemini has been live-tested; the Claude path has not yet been verified against a live Claude account. Read [`SECURITY.md`](SECURITY.md) before installing.

## Install on Windows

Download from the [GitHub Releases](https://github.com/andreasamundsen/agora/releases) page:

- `Agora-Setup-0.1.57.exe`
- `Agora-Setup-0.1.57.exe.sha256`

1. Back up `%APPDATA%\Agora\data` if you already have debates.
2. Close Agora, then run the installer. It is per-user and does not require administrator rights.
3. Windows SmartScreen will warn that the publisher is unknown. This build is intentionally unsigned: choose **More info → Run anyway**.
4. Verify the download against the checksum from the same release:

   ```powershell
   Get-FileHash .\Agora-Setup-0.1.57.exe -Algorithm SHA256
   ```

A matching hash confirms the file has not changed; it is not a code signature. There is no auto-update, so a future beta is a manual download and install.

The app stores its data under `%APPDATA%\Agora\data`, not in the repository's `data/` directory. Settings, including the API key, are stored there as plain JSON; use a dedicated key you can rotate.

## Run from source

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

`npm start` serves the built client and the API from one Node process. The server binds to `127.0.0.1` by default. Set `HOST=0.0.0.0` only if you deliberately want to expose it on your network; the API has no authentication and is intended for a single-user machine.

To build the Windows installer from source:

```bash
npm run dist
```

This produces `release/Agora-Setup-<version>.exe` and an NSIS blockmap. The installer bundles Electron and the compiled server, so users do not need Node. `npm run electron` runs the desktop shell directly; `npm run pack` produces an unpacked build for inspection.

The app works **before you connect a model**. It seeds two reference debates on first run, and the local scaffolder can still author maps, clearly labelled as a scaffold. A connected model makes the arguments topic-specific.

## Using Agora

### The library

Every debate is stored as plain JSON under `data/debates/`. Click a card to open it; use `×` to remove it.

### The map

The map is a pan/zoom argument graph. The thesis sits in the centre.

- **Case view** groups direct pro arguments on the left and direct con arguments on the right.
- **Thread view** keeps those direct cases in place but attaches each response to the argument it answers, extending the reply chain outward on that argument's side. Replies share vertical space, so Thread view stays close to Case view's height. A con reply can sit on the pro side where its target lives; the card's For/Against badge and colour carry the stance.
- Dense maps open as a complete overview; small maps open at a readable scale. Drag to pan, scroll to zoom, and use **Fit** to recover the whole shape.
- The static map refits when the window changes size. After a manual pan or zoom it preserves your view until you press **Fit**.
- Select a card for the inspector: full text, premises, conclusion, and relations.

### The chamber

The chamber is a conversation with the cartographer about the map, or about anything else. Ask what the crux is, where the weakest premise lies, which branch is doing the most work, what would change the conclusion, or ask a general question. Answers are concise prose, usually one substantial paragraph, and distinguish map claims from general knowledge. The chamber is read-only: it does not add, remove, move, or relink arguments. Without a model it gives a structural summary and says so.

### The stage

`Stage Debate` turns the map into a performance. The order is a seeded random walk through the graph: the motion opens, you state your position, advocates and challengers take turns, rebuttals surface where they connect, and the moderator closes. Each run samples a new sequence; `Cut a new sequence` resamples without leaving the stage. The camera follows the argument being made.

Stage controls: `Space` play/pause, `←`/`→` previous/next turn, a speed selector, optional browser speech, and `Esc` to close. The stage records nothing; it is a way of reading the map aloud.

### The bench

`Judge` puts the map on trial. The judgment is built from **local link assessments**: the model sees one arrow at a time — only the source claim, the target claim, and the relation type — and never the whole map.

- A **support** link returns a strength (`strong`, `moderate`, `weak`), a confidence, and short reasoning.
- An **attack** or **undercut** returns a verdict (`defeats`, `weakens`, `undecided`, `irrelevant`), an impact (`decisive`, `material`, `marginal`), a criterion, a target component, a confidence, and short reasoning.
- An independent **clustering call** sees all argument texts before any link is assessed and groups them by shared premise or mechanism. It sees no edges, verdicts, or ratings. A direct case line inherits its source argument's cluster.
- A deterministic engine propagates the consequences through the graph. There is no whole-map model reassessment.

Read the result as follows:

- Arguments can be **standing**, **defeated**, or **contested**. A surviving argument may also carry a **weakened** condition when a live ruling says the attack had real force but the argument survived.
- A defeated argument can be **reinstated** when its attacker is itself defeated.
- **Proof** and **hard defeat** are symmetric: both require a clean source at the selected evidence bar. A proof makes the motion stand unless a corroborated direct defeat also exists; when both exist, neither displaces the other and the thesis remains contested.
- `Falls` can mean the motion was directly defeated **or** that the weighted con case dominates. A direct `defeats` ruling on the thesis is not automatically final: it must be corroborated as a decisive impact by the local assessment.
- **Contested** case lines carry half weight. A standing source under a live attack carries a `0.6` pressure discount. The burden is applied once, in the final threshold, not again in the line weights.
- Only a **defeats** ruling removes an argument from the live fixed point; **weakens** and **undecided** remain visible as live pressure.

### Standards and evidence

Choose the **standard of proof** — pro must establish, con must establish, or preponderance — and the **evidence bar**.

The standard sets what the final case must show. Under a pro or con burden, that side must lead by at least `max(2, 20% of the total)` and hold at least **3/5** of the weighted case. Preponderance resolves anything outside a half-point deadband. The evidence bar is independent: **High** only lets high-confidence strikes remove an argument; **Medium** also allows medium-confidence strikes; **Low** also allows low-confidence strikes.

The deterministic solver turns the direct link ratings into weighted case lines — support quality or attack impact, confidence, survival, pressure, and node-cluster independence — discounts clustered variations of the same point, and closes with one of four outcomes: **stands**, **falls**, **undecided**, or **unestablished**.

### Playback and progress

The playback opens one branch for every argument directly tied to the motion, including a clean support with no clash. Stems alternate between For and Against when both sides have unplayed ones. After a stem is selected, it is drained: follow one response at each fork to the end, backtrack to the nearest unplayed fork under that stem, and follow the next branch. Only when no unplayed replies remain does the next direct stem begin. A support stem gets a visible direct-support beat before its first response.

Judgment controls: `Space` play/pause, `←`/`→` previous/next ruling, click any ruling row to seek, speed selector, and `Esc` to close. During playback, card status changes settle at the end of each ruling's beat; the ruling text is visible while the bench deliberates.

While assessments run, the judge modal streams the links currently being read, a real completed-link count and track, and an ETA that appears after the first link returns and refines after each completion. **Cancel judgment** stops scheduling further links. A judgment run is a **sidecar**: it never edits the debate, its nodes, or its edges; replay is free.

The bench uses the same provider and key as the rest of the app. Its **Judge model** field defaults to your configured model but can be overridden for the run. Each link prompt contains only the source claim, the target claim, and the relation type. Maps are capped at 80 links per sitting, with four links assessed at a time; a failed link is retried once, then the run aborts. Without a key, the bench runs a **local structural review** that demonstrates the procedure but is not a substantive judgment.

### Appearance

Settings → Appearance switches between **System**, **Light**, and **Dark**. System follows the Windows appearance setting. The choice is remembered on this machine and applied before the interface paints, so the dark reading room does not flash paper-white at launch. The desktop window background follows the saved theme on the next launch.

## Connecting a model

Open **Settings** (the gear). Agora supports OpenAI-compatible chat endpoints plus the native Claude and Gemini APIs:

| Preset | Base URL | Transport |
|---|---|---|
| No model | — | no model calls |
| OpenAI | `https://api.openai.com/v1` | OpenAI-compatible |
| DeepSeek | `https://api.deepseek.com` | OpenAI-compatible |
| xAI / Grok | `https://api.x.ai/v1` | OpenAI-compatible |
| Anthropic / Claude | `https://api.anthropic.com` | native Messages |
| Google / Gemini | `https://generativelanguage.googleapis.com` | native `generateContent` |
| Custom | any compatible base URL | OpenAI-compatible |

The model field accepts any model ID and also offers IDs returned by the saved provider's model list. Use **Refresh models** after changing the provider, or save the settings first; the list is read from the saved connection so the API key never has to leave the server. Example IDs are starting points, not a guarantee that a provider still offers them.

Thinking controls are model-aware:

- DeepSeek offers **Provider default / Off / Low / High / Max**; OpenAI reasoning models offer **Provider default / Low / Medium / High**; xAI Grok models offer **Provider default / Low / Medium / High / Max**.
- Claude 4.6 and later use adaptive thinking with **Provider default / Off / Low / Medium / High / Max**; older Claude thinking models use the same ladder as a token budget. **Off** is hidden where thinking is always on.
- Gemini 3 and later use thinking levels; Gemini 2.5 uses a thinking budget. Levels the model does not support are hidden, and **Off** is hidden where thinking cannot be disabled.
- Temperature is not sent while thinking is active. The app raises the output budget automatically when thinking is active so the JSON graph is not cut off.
- Custom endpoints do not get thinking controls because their parameter support cannot be verified.

Local models may expose their chain of thought in a separate `reasoning_content` field and spend much of the completion budget there before writing the final JSON. Agora gives loopback providers a 12,000-token output floor and up to five minutes for a generation. If the model still returns only hidden reasoning, Agora reports that clearly instead of treating the empty final content as a map.

`Save & test` first requests the provider's model list and, if necessary, sends a tiny completion; it gives up after 15 seconds with a visible error. A key is stored locally in Agora's data folder as plain JSON (gitignored in a source checkout) and is never returned to the browser; the UI only learns whether a key exists.

Development runs can use environment fallbacks: `AGORA_LLM_BASE_URL`, `AGORA_LLM_MODEL`, `AGORA_LLM_REASONING_EFFORT`, `AGORA_LLM_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `DEEPSEEK_API_KEY`, and `OPENROUTER_API_KEY`. The packaged desktop build ignores ambient provider keys and `.env` files; enter the key in Settings. Copy `.env.example` to `.env` only for development; a saved settings file wins over the environment.

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
    stage.ts            seeded random-walk staging + speaker narration
    judgment.ts         pure link assessments, grounded propagation, deterministic solver, summary, Markdown report
    demo.ts             two hand-authored reference debates
  server/
    index.ts            Express entry, Vite middleware in dev, static dist in prod
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
    argdown-import.ts   Argdown → Debate using @argdown/core
  shared/
    provider-url.ts     base URL normalization and provider URL validation
    provider-protocol.ts native endpoint and auth-protocol selection
    thinking.ts         thinking capability and provider wire mappings
    judge-progress.ts   shared judge progress events, concurrency, and ETA estimate
  ui/
    App.tsx             workspace, library, chamber, stage controller, judgment controller
    components/         DebateGraph, ChatPanel, StagePanel, NodeInspector, JudgmentModal, JudgmentPanel, Modals
    styles.css          editorial paper / library ink / dark wood stage
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
| `DELETE` | `/api/debates/:id` | remove |
| `GET` | `/api/debates/:id/argdown` | download source |
| `POST` | `/api/debates/:id/chat` | answer a question about the map from `{ text }`; no map edits |
| `POST` | `/api/debates/:id/judge` | `{ standard, strictness, model?, stream? }` → judgment run; `stream: true` returns NDJSON progress events ending in the run |
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
- Speech synthesis uses the operating system's installed voices; Agora does not upload audio.

See [`SECURITY.md`](SECURITY.md) for the current beta's security limitations, including the unsigned build and the packaged Electron version.

## Limits, honestly

- The **local scaffolder** produces a structurally useful map, not a topic-specific debate. Connect a model for actual arguments.
- The **local bench** is a structural demonstration, not a substantive judgment. Connect a model for real rulings.
- Judgment is **one clustering call plus one model call per argument link** and is not cached; a map with many replies can take a while and cost accordingly.
- A judgment run lives in the browser session as a sidecar. Export the report if you want the record to survive a reload.
- Authoring and chamber responses are non-streaming. Judgment progress is streamed, but the model's ruling text is still delivered as part of the assessment rather than token by token.
- Staging is a textual performance with optional browser speech, not audio mixing or avatars.
- The chamber can answer general questions from the selected model's training knowledge, but it does not browse or retrieve live web data.
- Single-user, stored locally. Model calls go to the provider you configure; there is no authentication, collaboration, or cloud sync.
- Argdown import is graph-first. Formatting details that have no graph meaning are not preserved.
- The Windows beta is unsigned, Windows x64 only, and has no auto-update or dedicated website. Claude has not been live-tested. The packaged Electron version has upstream security advisories; see `SECURITY.md`.

## Why the name

The agora was the public square where a city argued with itself. The interface is deliberately editorial: warm paper, serif headings, ink for the motion, faded red for the challenge, and a dark wood stage for the performance. The map is the argument; the stage is the argument being made; the bench is the argument being judged.

## License

Agora is released under the **MIT License**. See `LICENSE`. The software is provided as-is, without warranty; the unsigned beta build is distributed in the same spirit.
