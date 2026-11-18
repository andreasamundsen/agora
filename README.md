# Agora — a debate harness

> Every argument has a shape. Find it, then argue with it.

Agora turns a position into a map of arguments, lets you interrogate that map, exports it as **Argdown**, stages the debate as a sequence of turns with a live camera on the graph, and then **convenes a bench** to judge it: a model rules on each clash, and the map shows arguments falling, surviving, or returning until the motion stands or falls.

It is built in the spirit of a learning harness: the model is not there to agree with you. It builds the strongest case for your position, the strongest case against it, and the places where the two actually collide.

## Quick start

Requirements: **Node 20+** (developed on Node 26) and npm.

```bash
npm install
npm run dev
```

Open <http://localhost:5173>.

For a production-style run:

```bash
npm run build
npm start
```

`npm start` serves the built app and the API from the same Node process. The server binds to `127.0.0.1` by default. Set `HOST=0.0.0.0` only if you deliberately want to expose it on your network. There is no authentication, and the loopback Host check blocks ordinary LAN clients; do not treat this as a secure multi-user server.

### Desktop tester build

```bash
npm run dist
```

This produces `release/Agora-Setup-0.1.20.exe`, a per-user Windows NSIS installer. The installer is intentionally **unsigned** and does not auto-update. It bundles Electron and the compiled server, so testers do not need Node.

`npm run electron` runs the desktop shell directly; `npm run pack` produces an unpacked build for inspection.

The packaged app stores its data under `%APPDATA%\Agora\data`, not in the project's `data/` directory. This tester build keeps the existing settings format, so the API key is plain JSON inside `settings.json`; use a test key you can rotate. `TESTERS.md` contains the tester instructions.

The app works **before you connect a model**. Two reference debates are seeded on first run, and the local scaffolder can still author maps (labelled honestly as a scaffold). A connected model makes the arguments topic-specific.

**Appearance** — Settings → Appearance switches between **System**, **Light**, and **Dark**. System follows the Windows appearance setting. The choice is remembered on this machine and applied before the interface paints, so the dark reading room does not flash paper-white at launch. The desktop window background follows the saved theme on the next launch.

## The five surfaces

**The library** — every debate is stored as plain JSON under `data/debates/`. Click a card to open it, `×` to remove it.

**The map** — a pan/zoom argument graph. The thesis sits in the centre. The default **Case view** groups direct pro arguments on the left and direct con arguments on the right; **Thread view** keeps those two direct cases in place but attaches each response to the argument it answers, extending the response chain outward on that argument's side. Each response is anchored to its target's vertical centre; sibling responses fan around it, and a card only moves when it would collide with another card. Replies share vertical space in each outward lane, so Thread view stays close to the Case view's height. Stance remains on the card's For/Against badge and colour, so a con reply can sit on the pro side where its target lives. Dense maps open as a complete overview; small maps open at a readable scale. Drag to pan, scroll to zoom, use `Fit` to recover the whole shape. The static map refits when the window changes size; after a manual pan or zoom it preserves your view until you press `Fit`. Select any card for the inspector: full text, premises, conclusion, relations, and two questions you can send to the chamber.

**The chamber** — a conversation with the cartographer about the map. Ask what the crux is, where the weakest premise lies, which branch is doing the most work, or what would change the conclusion. Answers are short prose. The chamber is read-only: it does not add, remove, move, or relink arguments. Without a model, it gives a structural summary and says so.

**The stage** — `Stage Debate` turns the map into a performance. The order is a **seeded random walk** through the graph: the motion opens, you state your position, advocates and challengers take turns, rebuttals surface where they connect, and the moderator closes. Each run samples a new sequence; `Cut a new sequence` resamples without leaving the stage. The graph camera follows the argument being made.

Stage controls: `Space` play/pause, `←`/`→` previous/next turn, speed selector, optional browser speech, `Esc` to close. The stage records nothing; it is a way of reading the map aloud.

**The bench** — `Judge` puts the map on trial. The model rules on one attack or undercut at a time and returns a verdict — **defeats**, **weakens**, **undecided**, or **irrelevant** — with a criterion, a target component, a confidence, and short reasoning. The playback follows **case branches**: one direct argument is selected at random, its own clash is heard first, then the replies attacking it and the replies attacking those, before the next direct argument. Each branch is labelled `Case 1`, `Case 2`, and so on. The branch order is seeded per run, so replaying the same judgment shows the same sequence. A deterministic engine then propagates the consequences through the graph. Arguments can be **standing**, **defeated**, or **contested**; a surviving argument may also carry a **weakened** condition when a live ruling says the attack had real force but the argument survived. An argument that was defeated can be **reinstated** when its attacker is itself defeated. After the clashes, one extra model call rates the surviving **direct supports and direct attacks on the motion**. The engine turns those ratings into weighted case lines — quality or impact, confidence, survival or pressure, and independence — discounts clustered variations of the same point, and closes with one of four outcomes: **stands**, **falls**, **undecided**, or **unestablished**. A contested case line carries half weight on either side; the burden is then applied once, in the final threshold, rather than again in the line weights. A direct `defeats` ruling on the thesis is not automatically final: the weighing pass must corroborate it as a decisive con line, and the defeating attacker must not itself be weakened. Otherwise the ruling remains a live attack and the thesis stays **contested** while the balance decides the motion. The same weighing call can certify a clean direct pro support as a **proof** only when it is strong, high-confidence, and independently sufficient. A certified proof makes the motion stand unless a corroborated direct defeat also exists; a proof and a corroborated defeat cancel each other and leave the thesis **contested**.

Choose the **standard of proof** (pro must establish, con must establish, or preponderance) and how strict the bench is. Strict only lets high-confidence strikes remove an argument; balanced also allows medium-confidence strikes; generous lets the ruling stand even when the judge is unsure. The standard of proof now sets a **threshold**, not a veto: the motion must lead the weighted record by roughly two points under a pro burden, the con case must lead by roughly two points under a con burden, and preponderance resolves anything outside a half-point deadband. A heavily one-sided record decides the motion even against the nominal burden; the burden decides the close ones. `Falls` can therefore mean the motion was directly defeated **or** that the weighted con case dominates. The motion card speaks in those outcomes rather than ordinary argument statuses: before the first ruling it starts **undecided** under a pro or preponderance standard and **stands** provisionally under a con standard, then follows the live outcome until the bench finishes. A `weakens` or `undecided` ruling is live pressure on the burden even though it does not strike an argument. A non-thesis argument with a live `weakens` ruling is also marked **weakened** beside its status; a contested argument can show both. That condition is display-only for now: it does not change the weighted balance, and `undecided` alone does not produce it. `Save judgment report` downloads the full record as Markdown. `Exit` returns the map to normal without touching the underlying debate.

Judgment controls: `Space` play/pause, `←`/`→` previous/next ruling, click any tick or record row to seek, speed selector, `Esc` to close. A judgment run is a **sidecar**: it never edits the debate, its nodes, or its edges. Only a **defeats** ruling removes an argument from the live fixed point; **weakens** and **undecided** remain visible as live pressure. A direct defeat of the thesis is subject to the corroboration rule above; when it is withheld, the ruling remains in the record and the thesis stays contested. A certified proof and a corroborated direct defeat are both decisive claims: if both exist, neither displaces the other and the motion is undecided. Replay is free; running the bench again is a new model call for each clash plus one call to weigh the surviving case lines.

## Connecting a model

Open **Settings** (the gear). Agora speaks to any OpenAI-compatible `/chat/completions` endpoint:

- **OpenAI** — `https://api.openai.com/v1`, e.g. `gpt-4o-mini`
- **DeepSeek** — `https://api.deepseek.com`, `deepseek-flash` (V4.1 Flash)
- **LM Studio** — `http://127.0.0.1:1234/v1`, pick the model loaded there; no key needed
- **Ollama** — `http://127.0.0.1:11434/v1`, e.g. `llama3.1`; no key needed
- **Custom** — any compatible base URL and model

DeepSeek Flash supports thinking. Its **Reasoning effort** control offers **Off / Low / High / Max**; High is the default. Higher effort can improve difficult judgments, but it costs more and takes longer. Temperature is disabled for DeepSeek because the model ignores it; use reasoning effort instead. The app raises the output budget automatically when thinking is active so the JSON graph is not cut off.

Local models may expose their chain of thought in a separate `reasoning_content` field and spend much of the completion budget there before writing the final JSON. Agora gives loopback providers a 12,000-token output floor and up to five minutes for a generation. If the model still returns only hidden reasoning, Agora reports that clearly instead of treating the empty final content as a map.

`Save & test` first requests the provider's model list and, if necessary, sends a tiny completion; it gives up after 15 seconds with a visible error. A key is stored locally in Agora's data folder as plain JSON (gitignored in a source checkout) and is never returned to the browser; the UI only learns whether a key exists. Development runs can use environment fallbacks (`AGORA_LLM_BASE_URL`, `AGORA_LLM_MODEL`, `AGORA_LLM_REASONING_EFFORT`, `AGORA_LLM_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`). The packaged desktop build ignores ambient provider keys and `.env` files; enter the key in Settings. Copy `.env.example` to `.env` only for development; a saved settings file wins over the environment.

The bench uses the same provider and key. Its **Judge model** field defaults to your configured model but can be overridden for the run — useful if you want a different model to judge the cartographer's map. The judge is intentional about its view of the arguments; if you want a different bias, point it at a different model. Each clash prompt includes the target's own outgoing relations and a shortest path to the thesis — full text for direct destinations, conclusions for deeper path nodes — without sending the whole map. Judgment makes **one model call per attack/undercut**, four at a time, plus **one weighing call** for the surviving direct case lines. Maps are capped at 40 clashes per sitting. Without a key, the bench runs a **local structural review** that demonstrates the procedure but is not a substantive judgment; it has no weighing pass, so it keeps the structural hard fall as a placeholder. The UI says so in the record.

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

The exporter writes each argument's reasoning as `//` comments beneath its relations, so the map survives a round trip through the official parser without inventing edges. Premise–conclusion structures (`(1) … ---- (3) …`) are imported and shown in the inspector.

The map is capped at **42 nodes**, each argument at **520 characters**, and the chamber history at **80 messages**. When a model response or import reaches a cap, the UI reports what was shortened instead of dropping content silently. A debate file that cannot be parsed is skipped and named in a library warning; it is never overwritten by the store.

`Import` accepts a paste or a file (`.argdown`, `.ad`, `.md`, `.txt`). It uses `@argdown/core`'s parser and model builder, reports syntax errors with line numbers, and refuses prose that contains no argument structure. A blank motion title falls back to the document's first heading/claim.

Round-trip verified: **16-node reference map → Argdown → import → same 16 nodes and 16 relations** (`src/server/argdown-import.test.ts`).

## How it is put together

```
src/
  core/                 pure domain layer — no DOM, no network, no filesystem
    model.ts            Debate/Node/Edge types, reconciliation, prompt cleanup
    argdown.ts          Debate → Argdown serializer
    layout.ts           deterministic case/thread graph layouts
    stage.ts            seeded random-walk staging + speaker narration
    judgment.ts         pure clash adjudication, grounded propagation, verdict summary, Markdown report
    demo.ts             two hand-authored reference debates
  server/
    index.ts            Express entry, Vite middleware in dev, static dist in prod
    routes.ts           REST API (below)
    store.ts            JSON debate store + first-run seeding
    atomic-write.ts     non-destructive file replacement with retry/backup
    settings.ts         provider settings, environment fallbacks, public key status
    local-access.ts     loopback Host/Origin guard for the local API
    provider-test.ts    timeout-bounded provider connection test
    llm.ts              intake/extension prompts, zod validation, local fallback
    judge.ts            per-clash model adjudication and strictness enforcement
    argdown-import.ts   Argdown → Debate using @argdown/core
  shared/
    provider-url.ts     base URL normalization and provider URL validation
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
| `POST` | `/api/debates/:id/judge` | `{ standard, strictness, model? }` → judgment run |
| `POST` | `/api/import` | `{ source, motion? }` |
| `GET`/`PUT` | `/api/settings` | provider settings (key never returned) |
| `POST` | `/api/settings/test` | model-list check, then a tiny completion; 15-second limit |

## Tests and checks

```bash
npm test          # vitest: staging, Argdown export/import, judgment propagation/reinstatement/cycles/report
npm run typecheck # tsc --noEmit
npm run build     # vite production build
```

## Privacy and data flow

- Debates and settings live in `data/`, which is gitignored in a source checkout. In the packaged app the same files live under `%APPDATA%\Agora\data`.
- API keys are stored server-side only. The browser receives `hasKey: true/false`; the key is never included in an API response or written to `agora.log`.
- The desktop build stores settings as plain JSON and keeps them after uninstall. Use a key you can rotate; use **Forget saved key** in Settings before handing the machine on.
- **When you connect a model, the motion, argument map, chat messages, and judgment context you submit are sent directly to the provider you configure.** There is no remote Agora service, account, proxy, or cloud sync. The provider's terms, retention policy, and jurisdiction govern that data; do not paste confidential material unless you accept that.
- The local scaffolder and a local provider such as LM Studio/Ollama keep model work on this machine. The packaged app forces the local API to `127.0.0.1`.
- There is **no telemetry, analytics, crash reporting, or auto-update**. The app does not phone home.
- The desktop renderer is sandboxed with context isolation and a production Content-Security-Policy. It denies permission requests and keeps navigation inside the local app; the only external link (Argdown's site) opens in the default browser.
- There is no authentication on the local API. It is intended for a single-user machine; do not expose it to a network you do not trust.
- Speech synthesis uses the operating system's installed voices; Agora does not upload audio.

## Limits, honestly

- The **local scaffolder** produces a structurally useful map, not a topic-specific debate. Connect a model for actual arguments.
- The **local bench** is a structural demonstration, not a substantive judgment. Connect a model for real rulings.
- Judgment is **one model call per clash plus one weighing call** and is not cached; a large map can take a while and cost accordingly.
- A judgment run lives in the browser session as a sidecar. Export the report if you want the record to survive a reload.
- The model path is non-streaming: authoring a map or asking a chamber question can take a minute and the UI shows progress.
- Staging is a textual performance with optional browser speech, not audio mixing or avatars.
- Single-user, stored locally. Model calls go to the provider you configure; there is no authentication, collaboration, or cloud sync.
- Argdown import is graph-first. Formatting details that have no graph meaning are not preserved.

## Why the name

The agora was the public square where a city argued with itself. The interface is deliberately editorial: warm paper, serif headings, ink for the motion, faded red for the challenge, and a dark wood stage for the performance. The map is the argument; the stage is the argument being made; the bench is the argument being judged.
