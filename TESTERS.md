# Agora — public beta notes

Agora is a local debate harness. You install it like a normal Windows app; no Node, npm, or terminal is needed. The source code is public in this repository under the MIT License; the installer is a compiled Windows build. The beta is intentionally unsigned and has no auto-update. See `SECURITY.md` for the current security, privacy, and data-handling limitations.

## Install

1. Download `Agora-Setup-0.1.63.exe` and its `.sha256` sidecar from the GitHub Releases page.
2. Windows will warn that the publisher is unknown. This build is intentionally unsigned: choose **More info → Run anyway**.
3. The installer is per-user and does not need administrator rights. Agora opens when it finishes.
4. To upgrade, close Agora first, then run the newer installer over it. Your debates stay in `%APPDATA%\Agora\data`.
5. Verify the SHA-256 checksum against the value in the `.sha256` file from the same release. A matching hash is not a code signature; it only confirms the file has not changed.

## What's new in 0.1.63

- **Judgments can be saved.** At the finale, **Save judgment** stores the completed sitting with the debate. This is explicit: Agora does not auto-save a judgment.
- **Bench history keeps multiple runs per debate.** Open **Judge → Bench history → Saved judgments** to see each saved run's date, judge, outcome, and standard. **Open** replays a saved record; **Delete** removes it.
- **Saved records are read-only.** Opening one shows **Saved sitting / Recorded judgment** and cannot change the live map. Each record stores the run, its final snapshot, and a compact frozen copy of the map, so it still opens after the map changes.
- **Earlier-map records are clearly marked.** If the map has changed since a run was saved, history and the saved view label it as recorded from an earlier map. The frozen map is used for playback.
- Existing debates, settings, Argdown interchange, editing, Stage, provider behavior, and judgment arithmetic are unchanged. Saved data lives under `%APPDATA%\Agora\data\judgments` and never includes the API key.

## What's new in 0.1.62

- **Aurora is now a glossy black reading room with muted Peach Hour accents.** The paper is near-black, filled actions use a restrained peach → apricot → sun sweep, and the active library, motion card, and stage share the same warm light. Light and Night Reading Room are unchanged.
- **Argument cards use Spring & Watermelon.** Support is a fresher spring green (`#7ee787`) and attack a clearer watermelon red (`#ff7a8a`), with matching dark card fills, borders, glows, badges, edges, and speaker dots. The peach action and gold judgment remain distinct.
- **Preponderance near-ties scale with the weighted record.** The deadband is now `max(0.5, 0.05 × (P + C))`: 11–9 and 22–18 are decided, while 21–19 and 10.5–9.5 remain undecided at the boundary. Proof, hard defeat, and the other standards are unchanged.
- Existing debates, settings, Argdown interchange, editing, Stage, and provider behavior are unchanged.

## What's new in 0.1.61

- **The map is now editable.** **Edit map** opens a draft beside the graph. Change an argument’s kind, title, text, premises, conclusion, or tags; add a response; link an existing argument to another card or to the motion; retype or remove a relation; or remove a leaf argument.
- **Nothing is written until Done.** Cancel restores the saved map, and Undo/Redo stay inside the draft. Read mode keeps its clean card view with no per-card action buttons.
- **The editor protects the graph.** It refuses self-links, loops, removal of the motion, and removal of a card that would strand other responses. The map still works offline, exports and imports as Argdown, and preserves existing chat, origin, and judgment behaviour.
- Existing debates and settings are unchanged. The motion is editable but cannot be added or removed.

## What's new in 0.1.60

- **The stage now follows the bench’s branch rhythm.** Arguments directly tied to the motion alternate sides, and each root’s reply chain is drained before the next root begins. A new cut still gets a fresh seed, so the performance changes without becoming arbitrary.
- **Voice playback waits for the browser to finish speaking.** The fixed reading timer is disabled while **Read turns aloud** is on; the stage advances when the utterance ends, with a short pause and safety fallbacks if the speech engine never starts or never reports completion.
- **Next remains immediate.** Manual navigation, pause/resume, speed changes, and the closing finale are unchanged.
- The underlying map, judgment engine, and existing debate data are unchanged.

## What's new in 0.1.59

- **Long model lists now scroll properly.** The model suggestions open in a bounded menu with its own scrollbar, wheel scrolling, and keyboard navigation instead of clipping at the bottom of the settings window.
- **The picker opens on the selected model.** The current model is scrolled into view, typing filters the list, and clicking or pressing Enter selects a model. Free-text custom IDs still work.
- This is a settings-interface change only. Debate generation, judgment, playback, and existing data are unchanged.

## What's new in 0.1.58

- **The settings draft no longer loses your saved model.** Returning to the provider you already saved restores its saved base URL and model instead of replacing them with the preset default.
- **The former “Local only” preset is now “No model.”** Its base URL and model fields are genuinely blank, with no OpenAI placeholder text that could be mistaken for values.
- **Temperature now appears only when it applies.** It is hidden for models with a thinking control, in No model mode, and before a model is entered. It remains available for non-thinking and custom endpoints where the value is actually sent.
- These are settings-only changes. The judgment engine, model calls, and existing debate data are unchanged.

## What's new in 0.1.57

- **Judge progress now follows the actual link work.** The loading modal shows the real completed-link count, a completed-link track, and the four argument links currently being assessed, including their relation type and source → target.
- **The ETA is measured, not simulated.** It appears after the first link returns and is recalculated after every completion; the estimate is deliberately rough at first because four link calls run concurrently.
- **The clustering phase is separate.** The modal shows an indeterminate “Grouping the arguments” phase before link progress begins.
- **Cancel judgment stops scheduling new link calls.** Link calls already in flight may finish server-side, but no new links are started and the completed judgment is discarded.
- The judge still assesses four links at a time. Progress events carry work status only; verdicts and reasoning arrive with the final judgment, and the deterministic solver and playback are unchanged.

## What's new in 0.1.56

- **Claude and Gemini now use their native APIs.** The Anthropic preset talks to the Messages API and the Google preset talks to Gemini `generateContent`; both use their own authentication, request shape, model list, and response parsing instead of the OpenAI compatibility layer.
- **Claude thinking is model-aware.** Claude 4.6 and later use adaptive thinking with **Provider default / Off / Low / Medium / High / Max**; older thinking models use the same ladder as a token budget. **Off** is hidden on models where thinking cannot be disabled, such as Opus 5.5 and Sonnet 5.5.
- **Gemini thinking follows the model.** Gemini 3 and later use thinking levels; Gemini 2.5 uses a thinking budget. The app offers the levels the selected model supports, adds **Max** only where XHIGH exists, and hides **Off** where disabling is not accepted.
- **Model discovery is native for both.** Refresh models after saving the Claude or Gemini connection to load the provider's own model list.
- Claude structured responses use Agora's JSON prompt contract and tolerant parser rather than a forced response-format field; Gemini requests JSON with `responseMimeType`.

## What's new in 0.1.55

- **A direct attacker under live pressure now carries the same case-weight discount as a pressured support.** If the attacker is standing but targeted by a `weakens` or `undecided` ruling, its ordinary con line uses the existing `0.6` pressure factor. A clean attacker stays at `1.0`; a contested attacker keeps its half-survival weight without a second discount.
- **The structural `defeats` relation is unchanged.** A `weakens` on an attacker reduces its ordinary case weight and still withholds hard-fall certification, but it does not erase the attacker’s defeat of its target. Only a `defeats` on the attacker removes it and permits reinstatement.
- The balance panel labels the affected con line **attacker pressured** and shows the pressure factor in its tooltip.

## What's new in 0.1.54

- **The record now lists every judged link, including direct supports.** The bench assesses each argument relation locally and hands the results to the deterministic engine. Supports show their quality, confidence, reasoning, and effect in the same record as the conflict rulings; they still never count as conflict rulings or change the verdict math.
- **Supports are numbered stations in one playback timeline.** Supports carry a continuous record number with a small `S` marker. Play, Next, Previous, and clicking any record row all move the same cursor; selecting a support gives it the only gold row, opens its case-line card, and spotlights its source and target on the map.
- **Future entries stay readable but keep their assessment concealed** until playback reaches them. Selecting a future support enters that station and reveals it.
- **The final judgment has its own destination.** Once the finale is reached, an unnumbered **Final judgment** row stays at the bottom of the record after you browse back through earlier entries. Clicking it returns to the finale without replaying; it is not counted as a link, ruling, or support.
- **The record header separates the counts:** total links, conflict rulings, and supports. A final support gets its own beat before the separate final-judgment state.

## What's new in 0.1.53

- **Supporting arguments keep their turn in the playback, including when they have replies.** The previous attempt suppressed a support cue whenever its first response targeted the same card; that removed the support turn entirely for responding arguments. Support stems are restored, with duplicate cues removed instead.
- **The motion card follows the trial in sequence.** It starts undecided under a pro or preponderance standard, changes to **Falls** when the thesis is defeated, returns to its opening label if that defeat is reversed, and shows **✓ Proved** only when a direct support is proved. Non-motion cards no longer carry a proof badge.
- **Arguments whose every outgoing clash was ruled irrelevant are marked in gray.** The **Irrelevant** badge is display-only and takes precedence over Defeated or Contested while it applies.

## What's new in 0.1.52

- **Settings now has a Model instructions inspector.** Open Settings → Model instructions to read the built-in policy for the judge, weighing clerk, authoring, and chamber. The inspector is read-only and shows the substantive policy without the fixed JSON output contract. This is a transparency view only; it does not change prompt behavior.

## What's new in 0.1.51

- **Production dependency audit is clean.** The bundled Argdown parser stack now resolves `lodash-es` 4.18.1 through a package override, addressing the two lodash advisories (CVE-2026-4800 and CVE-2026-2950). `npm audit --omit=dev` reports zero vulnerabilities. No app behavior was intentionally changed.

## What's new in 0.1.50

- **Judgment playback is calmer and clearer.** Each direct argument's branches are drained before the next stem, card and count changes settle at the end of each beat, and the Rulings list keeps every ruling visible while concealing future verdicts.
- **Judgment keeps the map's relation colors.** Active attacks stay red, undercuts stay purple, and support case lines stay green. A proved motion now shows a single green **✓ Proved** badge.
- **Argdown export uses native premise-conclusion structures** and branch-first order; the round-trip preserves the reasoning sections.
- **Map routing is cleaner.** Short same-lane secondary links route around the outside, and short diagonal links no longer end with an arrow pointing away from the target. The reader's Case/Thread choice persists across map changes.
- The inspector gives the conclusion more prominence; authoring prompts ask for tighter premises and conclusions.

## What's new in 0.1.29

- **A stem is now drained completely before the next stem starts.** After the direct ruling, playback follows one branch to its leaf, backtracks to the nearest unplayed fork under that same stem, and continues until that stem has no unplayed replies. Only then does the next direct argument begin.
- This removes the cross-stem jump where a response to the first stem appeared after a different stem had already started. All of one stem's branches now stay together in the record.
- Branch selection, Thread view, support stem beats, the verdict engine, weights, and the written record are unchanged. The final fallback is only for disconnected records that no direct stem can reach.

## What's new in 0.1.28

- **Judgment playback is now branch-first.** Each branch begins at an argument directly tied to the motion — support or adversarial — and follows one response at each fork outward to the end. The stems are opened in alternating For/Against order, so every direct argument is selected before the playback returns for a second branch.
- **Judgment uses Thread view.** The map switches to Thread view for the bench and returns to your previous view when judgment closes. This keeps a branch extending left or right from the argument it answers.
- **Remaining sibling branches play in later passes**, so every ruling still appears exactly once. A clean support gets a stem beat even when it has no clash ruling.
- The old case grouping and its within-case backtracking are gone; the verdict engine, weights, and record are unchanged.

## What's new in 0.1.27

- **Branch targets are selected before their replies, not just direct support roots.** After one branch ends, the next branch opens by holding the argument it answers on the map first. This covers a support at a fork, a nested support, and a support whose reply is not reached from the direct case root.
- **Each branch opening is a real playback beat.** It appears in the timeline, works through `Next`, and is honoured when you seek to the first ruling of a branch. The same support can be opened again for a second branch.
- The verdict order, case ownership, and the written record are unchanged.

## What's new in 0.1.26

- **A support-root branch now opens at its direct support.** When a direct pro argument has a reply, the playback first holds that argument on the map, then follows the reply branch. Previously the support root could be seen as a brief cue and the first actual ruling was its reply, so the branch read backwards.
- **The opening beat is part of the timeline and manual stepping.** Click its `Direct support opens …` row, or press Next at the case boundary, and the root is selected before the first reply. Clean supports with no replies remain a one-card case cue.

## What's new in 0.1.25

- **Judgment playback follows one reply branch at a time.** After the direct clash it takes one randomly chosen reply, then one reply to that reply, and continues to the end of that branch. When the branch ends, it backtracks to the nearest fork and takes the next unplayed reply.
- **Every ruling still plays exactly once**, and sibling branches remain seeded-random. Case roots, For/Against alternation, the clean-support case cue, and the written record are unchanged.

## What's new in 0.1.24

- **Every direct argument opens a case**, including a clean support with no clash. Cases alternate between For and Against when both sides have unplayed cases.
- Responses were revealed breadth-first at each depth: the direct clash, then all immediate replies, then replies to those.
- A clean support got a one-card case cue, not a ruling. Shared replies had one case owner, chosen by the route nearest the motion.

## What's new in 0.1.23

- **Proof and defeat now use the same evidence bar.** A clean direct support and a clean direct attacker are judged at the same Strictness setting: high confidence under Strict, medium under Balanced, low under Generous. The old extra high-confidence requirement for `proves` is gone.
- **A failed weighing pass no longer gives either side an automatic result.** If the assessment cannot run, Agora does not invent a hit or a proof; the weighted balance decides and the warning is recorded.
- **Proved supports are visible on the map.** A direct support that is proved gets an ink-seal treatment; the motion card gets a small proof marker. Defeated cards are still crossed out.

## What's new in 0.1.22

- The chamber now answers general questions — definitions, facts, explanations — as well as questions about the map. General answers are identified as outside the map; map answers still cite the relevant cards.
- Prose questions no longer use the provider's JSON mode. Simple questions that previously fell back to a structural summary (for example “What is the capital of Norway?”) now get a normal answer.
- General answers use the model's existing knowledge; Agora still does not browse the web or retrieve live data.

## What's new in 0.1.21

- **The chamber is now read-only.** It answers questions about the map in concise prose and never adds, removes, moves, or relinks cards. The old extension suggestions are gone.
- Answers can be a substantial paragraph (usually 4–7 sentences, roughly 120–200 words), with up to two paragraphs for multi-part questions. Narrow questions stay shorter.
- JSON-wrapped model answers are unwrapped. If a model returns a map patch, Agora refuses to apply or display it.
- The node inspector is now purely informational; the two question shortcut buttons were removed.

## What's new in 0.1.20

- Local-model judgment now accepts the `null` values that models such as `qwen/qwen3-14b` emit for the optional `quality` or `impact` field they are not using. Previously the weighing pass rejected that response and fell back to structural weights.
- A one-clash local judgment test now completes with model-assessed balance and no warning.

## What's new in 0.1.19

- Local models that expose a hidden `reasoning_content` channel now get a larger completion budget (12,000 tokens) and a five-minute request window. A reasoning-heavy model can finish its thinking and still return the final JSON map.
- If a local model returns only hidden reasoning and no final answer, Agora now says so explicitly instead of treating the empty content as an empty map.
- Remote-provider token budgets and timeouts are unchanged.

## What's new in 0.1.18

- The tester build is harder to misconfigure. A remote provider must use HTTPS when an API key is present; local loopback providers still work over HTTP. Packaged builds ignore API keys inherited from the Windows environment.
- **Save & Test** now has a 15-second limit and reports a timeout instead of hanging.
- Unreadable debate files are left untouched and named in a library warning instead of being silently hidden.
- The map warns when a model response or import reaches the 42-node, 520-character, or 80-message limits. An empty model map falls back to the local scaffolder with a visible note.
- The desktop shell denies permission requests and keeps navigation inside the local app; the only external link opens Argdown's site in the default browser.
- Settings shows the installed version at the bottom of the panel. The build carries no auto-update or release metadata.

## What's new in 0.1.17

- Thread view now anchors each response to the vertical centre of the argument it answers.
- Sibling responses fan around their shared target instead of stacking only downward.
- A response only moves when it would collide with another card; lanes are no longer recentred as a whole.
- Direct arguments in Thread view have a little more breathing room. The map remains close to Case view's height and keeps cards from overlapping.

## What's new in 0.1.16

- Judgment playback now follows **case branches**: one direct argument is selected at random, its own clash is heard first, then the replies attacking it and the replies attacking those, before the next direct argument.
- Each branch is labelled `Case 1`, `Case 2`, and so on. The branch order is seeded per run, so replaying the same judgment shows the same sequence.
- Direct-support cues remain one at a time and still appear before the first clash that attacks their source.
- The clash verdicts, engine, and final outcome are unchanged. There is still no final support pulse.

## What's new in 0.1.15

- Judgment now introduces each direct support once, one at a time, immediately before the first clash that targets its source argument.
- The case-line cue is visual only. It does not create a ruling, change a status, or add a model call.
- Supports that no clash attacks are introduced before the first ruling.
- There is no final support pulse; the outcome seal and card statuses carry the result.
- Clash order is unchanged. The single status badge and the darker dark-mode controls remain.

## What's new in 0.1.14

- Superseded by 0.1.15: the clash-only animation was restored briefly, then direct supports were reintroduced as non-ruling case-line cues.
- Judgment animation removed the grouped support opening/ending beats.
- Argument cards keep the single status badge.
- The judgment setup header and playback controls keep the darker dark-mode surfaces.

## What's new in 0.1.12

- Judgment is now symmetric. A direct **defeats** ruling on the motion only makes it fall when the attacker is still standing and the ruling is decisive with at least medium confidence.
- A clean, strong, high-confidence pro line could be certified as **proves** in 0.1.22; 0.1.23 replaces that separate flag with the shared evidence bar above. A proof alone can carry the motion; a proof and a corroborated defeat together are a procedural tie.
- Contested direct case lines now count at **half weight on both sides**. A contested support no longer silently disappears from the pro balance.
- The bench still uses one model for the whole run and no extra judge calls were added.
- The selected standard of proof remains the only intentional asymmetry.
- Night Reading Room dark mode is unchanged.

## Connect a model

Agora opens with two demo debates and a local scaffold, but real argument generation needs a model.

1. Open **Settings** (the gear, top right).
2. Choose a provider: **DeepSeek**, **OpenAI**, **xAI / Grok**, **Anthropic / Claude**, **Google / Gemini**, or **Custom**. Claude and Gemini use their native APIs; Custom is for another OpenAI-compatible endpoint, including a local server.
3. For DeepSeek, choose a **Reasoning effort**: **Provider default**, **Off**, **Low**, **High**, or **Max**. High is the default. Higher effort can improve hard judgments but takes longer and costs more. Temperature is intentionally disabled for DeepSeek.
4. Other providers expose the thinking levels their selected model supports. Claude and Gemini controls are model-aware; a level the model cannot use is hidden rather than sent and rejected.
5. Paste your own API key and press **Save & Test**.
6. Close Settings and try **New debate**, the chat, or **Judge**.

Compatibility note: the tested path is current model IDs. Older or retired IDs may fail even when the provider still lists them, and **Max** thinking can fail or time out on some models; try **Provider default** or a lower level. xAI/Grok has not been live-tested yet.

Provider calls go directly from your machine to the provider you choose. When you connect a model, the motion, argument map, chat messages, and judgment context you submit are sent to that provider; Agora does not proxy them through a server of its own. Your key is stored locally as plain JSON, so use a key you can rotate. Agora has no telemetry, crash reporting, analytics, or auto-update.

## What to try

- Open a demo debate and explore the argument map. Use **Case** and **Thread** at the bottom right: Thread attaches each reply to the argument it answers, and both views stay at a similar height. The map refits when you resize the window; after you pan or zoom manually, it keeps your view until you press **Fit**.
- Press **Edit map** to try the draft editor: change a title, add a response, link an existing argument, and retype a relation. Use **Cancel** for experiments, then **Done** when you want to save one. Read mode returns with no per-card buttons.
- Press **Judge**, choose a standard, and run a judgment. After the clashes, the bench weighs the surviving direct case lines. A contested case line carries half weight on either side; the selected burden is applied once, in the final threshold. A direct **defeats** ruling on the motion is not automatically final: the weighing pass must corroborate it as a **decisive** con line at the selected Strictness, and the attacker must be clean. Otherwise the ruling remains a live attack, the motion stays contested, and the weighted balance decides. The weighing pass can also prove a clean, strong direct support at the same Strictness bar; that makes the motion stand unless a corroborated direct defeat also exists, in which case the two decisive claims cancel and the motion is undecided. The judge now receives each target's own relation and a short path to the motion, so rulings on replies are grounded in what the target was answering. The standard sets the threshold, not a veto: a lopsided record decides, and the burden decides the close ones. A **falls** outcome can come from a corroborated direct strike on the motion or from a weighted con case that dominates. A surviving argument can also show a **weakened** condition beside its status when a ruling says the attack had real force but did not strike it. `Save judgment report` downloads the balance and the rulings.
- Press **Stage Debate** to watch the exchange.
- Use **Import** / **Export** to move a debate as Argdown.
- Ask the chamber about the map or anything else. Map questions cite the relevant cards; general questions are answered from the model's own knowledge. It answers only; it does not edit the map.

## Where things live

- Debates and settings: `%APPDATA%\Agora\data`
- App log: `%APPDATA%\Agora\agora.log`
- The app installs under `%LOCALAPPDATA%\Programs\Agora`
- Uninstalling removes the app but keeps your debates.
- If a debate file cannot be read, Agora leaves it in place and names it in a warning instead of deleting or overwriting it.
- To reset completely, uninstall and delete `%APPDATA%\Agora`.

This public beta stores settings locally as plain JSON. Use a key you can rotate, and do not use a shared production key.

## Sending feedback

There is no automatic feedback or auto-update. If something breaks, open an issue at <https://github.com/andreasamundsen/agora/issues> with:

- the version shown in Settings (bottom of the panel),
- a short description of what you did,
- an exported debate or judgment report if relevant.

Do not paste API keys or unredacted logs into a public issue. `%APPDATA%\Agora\agora.log` can contain local paths and the Windows username; review it before sharing.

To replace this build, run a newer installer over it. Your debates stay in `%APPDATA%\Agora\data`.
