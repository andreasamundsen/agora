# Agora — private beta notes

Agora is a local debate harness. You install it like a normal Windows app; no Node, npm, or terminal is needed. This is a binary-only private beta: Agora's source files are not included. See `PRIVATE-BETA.txt` for the handoff note and `BETA-TERMS.txt` for the evaluation terms.

## Install

1. Run `Agora-Setup-0.1.52.exe`.
2. Windows will warn that the publisher is unknown. This build is intentionally unsigned: choose **More info → Run anyway**.
3. The installer is per-user and does not need administrator rights. Agora opens when it finishes.
4. To upgrade, close Agora first, then run the newer installer over it. Your debates stay in `%APPDATA%\Agora\data`.
5. The SHA-256 checksum should match the file supplied with the build. A matching hash is not a code signature; it only confirms the file has not changed.

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
2. Choose a provider: **DeepSeek**, **OpenAI**, or **Custom** for another OpenAI-compatible endpoint. The DeepSeek preset uses `deepseek-flash` (V4.1 Flash).
3. For DeepSeek, choose a **Reasoning effort**: **Off**, **Low**, **High**, or **Max**. High is the default. Higher effort can improve hard judgments but takes longer and costs more. Temperature is intentionally disabled for DeepSeek.
4. Paste your own API key and press **Save & Test**.
5. Close Settings and try **New debate**, the chat, or **Judge**.

Provider calls go directly from your machine to the provider you choose. When you connect a model, the motion, argument map, chat messages, and judgment context you submit are sent to that provider; Agora does not proxy them through a server of its own. Your key is stored locally as plain JSON, so use a key you can rotate. Agora has no telemetry, crash reporting, analytics, or auto-update.

## What to try

- Open a demo debate and explore the argument map. Use **Case** and **Thread** at the bottom right: Thread attaches each reply to the argument it answers, and both views stay at a similar height. The map refits when you resize the window; after you pan or zoom manually, it keeps your view until you press **Fit**.
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

This private beta stores settings locally as plain JSON. Use a key you can rotate, and do not use a shared production key.

## Sending feedback

There is no automatic feedback or auto-update. If something breaks, send:

- the version shown in Settings (bottom of the panel),
- a short description of what you did,
- `%APPDATA%\Agora\agora.log` (it contains local paths and the Windows username; review before sending),
- an exported debate or judgment report if relevant.

To replace this build, run a newer installer over it. Your debates stay in `%APPDATA%\Agora\data`.
