# Agora — tester notes

Agora is a local debate harness. You install it like a normal Windows app; no Node, npm, or terminal is needed.

## Install

1. Run `Agora-Setup-0.1.22.exe`.
2. Windows will warn that the publisher is unknown. This build is intentionally unsigned: choose **More info → Run anyway**.
3. The installer is per-user and does not need administrator rights. Agora opens when it finishes.
4. To upgrade, close Agora first, then run the newer installer over it. Your debates stay in `%APPDATA%\Agora\data`.
5. The SHA-256 checksum should match the file supplied with the build. A matching hash is not a code signature; it only confirms the file has not changed.

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
- A clean, strong, high-confidence pro line can now be certified as **proves**. A certified proof alone can carry the motion; a certified proof and a corroborated defeat together are a procedural tie.
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
- Press **Judge**, choose a standard, and run a judgment. After the clashes, the bench weighs the surviving direct case lines. A contested case line carries half weight on either side; the selected burden is applied once, in the final threshold. A direct **defeats** ruling on the motion is not automatically final: the weighing pass must corroborate it as a **decisive** con line, and the defeating objection must not itself be weakened. Otherwise the ruling remains a live attack, the motion stays contested, and the weighted balance decides. The weighing pass can also certify a clean, strong, high-confidence direct support as a **proof**; that makes the motion stand unless a corroborated direct defeat also exists, in which case the two decisive claims cancel and the motion is undecided. The judge now receives each target's own relation and a short path to the motion, so rulings on replies are grounded in what the target was answering. The standard sets the threshold, not a veto: a lopsided record decides, and the burden decides the close ones. A **falls** outcome can come from a corroborated direct strike on the motion or from a weighted con case that dominates. A surviving argument can also show a **weakened** condition beside its status when a ruling says the attack had real force but did not strike it. `Save judgment report` downloads the balance and the rulings.
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

This tester build stores settings locally as plain JSON. Use a key you can rotate, and do not use a shared production key.

## Sending feedback

There is no automatic feedback or auto-update. If something breaks, send:

- the version shown in Settings (bottom of the panel),
- a short description of what you did,
- `%APPDATA%\Agora\agora.log` (it contains local paths and the Windows username; review before sending),
- an exported debate or judgment report if relevant.

To replace this build, run a newer installer over it. Your debates stay in `%APPDATA%\Agora\data`.
