# Agora — tester notes

Agora is a local debate harness. You install it like a normal Windows app; no Node, npm, or terminal is needed.

## Install

1. Run `Agora-Setup-0.1.1.exe`.
2. Windows will warn that the publisher is unknown. This build is intentionally unsigned: choose **More info → Run anyway**.
3. The installer is per-user and does not need administrator rights. Agora opens when it finishes.

## Connect a model

Agora opens with two demo debates and a local scaffold, but real argument generation needs a model.

1. Open **Settings** (the gear, top right).
2. Choose a provider: **DeepSeek**, **OpenAI**, or **Custom** for another OpenAI-compatible endpoint. DeepSeek is the cheapest option for testing.
3. Paste your own API key and press **Save & Test**.
4. Close Settings and try **New debate**, the chat, or **Judge**.

Provider calls go directly from your machine to the provider you choose. Agora does not provide or proxy a key.

## What to try

- Open a demo debate and explore the argument map.
- Press **Judge**, choose a standard, and run a judgment. A **weakens** or **undecided** direct objection is live pressure: under the pro standard the motion is unestablished rather than defaulting to stands. Only a **defeats** ruling strikes an argument.
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
