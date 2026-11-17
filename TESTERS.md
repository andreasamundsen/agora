# Agora — tester notes

Agora is a local debate harness. You install it like a normal Windows app; no Node, npm, or terminal is needed.

## Install

1. Run `Agora-Setup-0.1.11.exe`.
2. Windows will warn that the publisher is unknown. This build is intentionally unsigned: choose **More info → Run anyway**.
3. The installer is per-user and does not need administrator rights. Agora opens when it finishes.

## What's new in 0.1.11

- Initial maps now build the argument case as a structure of claims and replies, rather than mostly two lists of direct arguments.
- Each major direct argument should normally carry at least one serious reply; a contested reply can carry a further response.
- The authoring guideline is now roughly 14–20 nodes, with room for replies while still refusing filler. Genuinely unanswered objections remain unanswered.
- Chamber extension patches are unchanged at 2–5 nodes per request.
- Night Reading Room dark mode from 0.1.10 is unchanged.

## Connect a model

Agora opens with two demo debates and a local scaffold, but real argument generation needs a model.

1. Open **Settings** (the gear, top right).
2. Choose a provider: **DeepSeek**, **OpenAI**, or **Custom** for another OpenAI-compatible endpoint. The DeepSeek preset uses `deepseek-flash` (V4.1 Flash).
3. For DeepSeek, choose a **Reasoning effort**: **Off**, **Low**, **High**, or **Max**. High is the default. Higher effort can improve hard judgments but takes longer and costs more. Temperature is intentionally disabled for DeepSeek.
4. Paste your own API key and press **Save & Test**.
5. Close Settings and try **New debate**, the chat, or **Judge**.

Provider calls go directly from your machine to the provider you choose. Agora does not provide or proxy a key.

## What to try

- Open a demo debate and explore the argument map. Use **Case** and **Thread** at the bottom right: Thread attaches each reply to the argument it answers, and both views stay at a similar height. The map refits when you resize the window; after you pan or zoom manually, it keeps your view until you press **Fit**.
- Press **Judge**, choose a standard, and run a judgment. After the clashes, the bench weighs the surviving direct case lines. A contested case line carries half weight on either side; the selected burden is applied once, in the final threshold. A direct **defeats** ruling on the motion is not automatically final: the weighing pass must corroborate it as a **decisive** con line, and the defeating objection must not itself be weakened. Otherwise the ruling remains a live attack, the motion stays contested, and the weighted balance decides. The weighing pass can also certify a clean, strong, high-confidence direct support as a **proof**; that makes the motion stand unless a corroborated direct defeat also exists, in which case the two decisive claims cancel and the motion is undecided. The judge now receives each target's own relation and a short path to the motion, so rulings on replies are grounded in what the target was answering. The standard sets the threshold, not a veto: a lopsided record decides, and the burden decides the close ones. A **falls** outcome can come from a corroborated direct strike on the motion or from a weighted con case that dominates. A surviving argument can also show a **weakened** condition beside its status when a ruling says the attack had real force but did not strike it. `Save judgment report` downloads the balance and the rulings.
- Press **Stage Debate** to watch the exchange.
- Use **Import** / **Export** to move a debate as Argdown.
- Ask the chamber for a counterargument or a missing premise.

## Where things live

- Debates and settings: `%APPDATA%\Agora\data`
- App log: `%APPDATA%\Agora\agora.log`
- The app installs under `%LOCALAPPDATA%\Programs\Agora`
- Uninstalling removes the app but keeps your debates.
- To reset completely, uninstall and delete `%APPDATA%\Agora`.

This tester build stores settings locally as plain JSON. Use a key you can rotate, and do not use a shared production key.

## Sending feedback

There is no automatic feedback or auto-update. If something breaks, send:

- the version shown in the app,
- a short description of what you did,
- `%APPDATA%\Agora\agora.log`,
- an exported debate or judgment report if relevant.

To replace this build, run a newer installer over it. Your debates stay in `%APPDATA%\Agora\data`.
