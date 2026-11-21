# Security and privacy

Agora is an early public beta. This page describes the current build honestly so you can decide whether it is appropriate for your use.

## Downloads

- Download Agora only from the [GitHub Releases](https://github.com/andreasamundsen/agora/releases) page.
- The Windows installer is **not code-signed**. Windows SmartScreen may warn you; the signature is intentionally deferred for this beta.
- Each release includes a `.sha256` checksum. Verify it before running the installer:

  ```powershell
  Get-FileHash .\Agora-Setup-0.1.60.exe -Algorithm SHA256
  ```

  Compare the result with the `.sha256` file attached to the same release. Do not trust a checksum copied from an issue or a chat message.
- There is **no auto-update**. Installing a newer build is a manual download and install.
- No dedicated Agora website, account system, or cloud service exists yet.

## Your data and API key

- Debates, settings, and the API key are stored locally under `%APPDATA%\Agora\data`.
- The API key is stored as **plain JSON** in `settings.json`, not in the Windows credential store. Anyone who can read your Windows profile can read the key. Use a dedicated, rotatable key and remove it with **Forget saved key** when you are done.
- There is **no telemetry, analytics, crash reporting, or phone-home**. The app does not upload logs or debate data to the Agora project.
- When you connect a model, the content you submit (the motion, map, chamber questions, and judgment context) is sent directly to the provider you configure. The provider's terms, retention policy, and jurisdiction apply. Do not submit confidential material unless you accept that.
- The local scaffolder, and a **Custom** provider pointing at a local model, keep model work on your machine.
- Back up `%APPDATA%\Agora\data` before upgrading or experimenting.

## Local server

- The packaged app forces its API server to `127.0.0.1` and is intended for a single-user desktop.
- The local API has **no authentication**. Do not expose it to a network or run it on a shared machine where other users can reach the port.
- The renderer uses context isolation, sandboxing, a production Content-Security-Policy, denied permission requests, and restricted navigation. These reduce risk; they are not a substitute for a security review.

## Beta limitations

- Windows only for the packaged build.
- No third-party security audit or penetration test has been completed for this beta.
- The current beta packages **Electron 40.10.2**. That Electron line has known upstream security advisories; the renderer hardening above reduces exposure but does not eliminate it. A runtime upgrade is planned before a stable release. Treat this beta as early software, not a hardened build.
- OpenAI, DeepSeek, Claude, and Gemini have been live-tested against real accounts; xAI/Grok has not. Provider compatibility is strongest with current model IDs; older or retired models and some **Max** thinking settings may fail or time out. Other provider/model combinations may behave differently.
- Dependency audits of production runtime dependencies are run at release time; development/test tooling is not shipped in the installer, but its reports may still appear when running `npm audit` in a source checkout.
- The app is provided **as-is**, under the MIT License, without warranty. See `LICENSE`.

## Reporting a problem

Open an issue at <https://github.com/andreasamundsen/agora/issues> with the version shown in Settings and a short description. Please do **not** include API keys, tokens, personal debate content, or unredacted logs in a public issue. Logs may contain local paths and your Windows username; review them before sharing.

If GitHub's private vulnerability reporting is available for this repository, use that for security-sensitive reports.
