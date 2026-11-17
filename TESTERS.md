# Agora — tester notes

Agora is a local debate harness. You install it like a normal Windows app; no Node, npm, or terminal is needed.

## Install

1. Run `Agora-Setup-0.1.13.exe`.
2. Windows will warn that the publisher is unknown. This build is intentionally unsigned: choose **More info → Run anyway**.
3. The installer is per-user and does not need administrator rights. Agora opens when it finishes.

## What's new in 0.1.13

- Judgment playback now opens with a short beat over the direct supporting arguments, then returns to the surviving support lines when the final balance is struck.
- Argument cards now show one status badge. **Weakened** replaces **Stands** for a standing argument that has taken damage; contested and defeated states take precedence.
- The judgment setup header and playback controls are darker in dark mode, with stronger labels on the speed and exit controls.
- The motion's opening display remains standard-aware, as before.

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
