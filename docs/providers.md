# Providers & models

Agora can use OpenAI-compatible endpoints, OpenRouter, DeepSeek, the native Claude API, and the native Gemini API. This guide covers provider setup, model IDs, thinking controls, and the request-shape caveats.

[Back to README](../README.md) · [Using Agora](using-agora.md) · [Judging](judging.md)


## Settings

Open **Settings** (the gear). Agora supports OpenAI-compatible chat endpoints (including OpenRouter) plus the native Claude and Gemini APIs:

| Preset | Base URL | Transport |
|---|---|---|
| No model | — | no model calls |
| OpenAI | `https://api.openai.com/v1` | OpenAI-compatible |
| OpenRouter | `https://openrouter.ai/api/v1` | OpenAI-compatible |
| DeepSeek | `https://api.deepseek.com` | OpenAI-compatible |
| xAI / Grok | `https://api.x.ai/v1` | OpenAI-compatible |
| Anthropic / Claude | `https://api.anthropic.com` | native Messages |
| Google / Gemini | `https://generativelanguage.googleapis.com` | native `generateContent` |
| Custom | any compatible base URL | OpenAI-compatible |

The OpenRouter preset starts with `openai/gpt-4o-mini`; OpenRouter model IDs are vendor-prefixed, and **Refresh models** loads the catalogue for your saved key. During testing, OpenRouter's xAI Grok 4.5, 4.6, and 4.7 routes stalled after returning response headers on the full authoring prompt. Agora now bounds that wait and reports a timeout instead of hanging indefinitely, but use another OpenRouter model if generation does not complete. Thinking controls are read from OpenRouter's own catalogue metadata: models that advertise reasoning and an effort list get a control narrowed to those levels; models with reasoning but no effort list get a provider-default/off choice; models without that metadata stay on their provider default. The catalogue is cached briefly; **Refresh models** forces a fresh read.

The model field accepts any model ID and also offers IDs returned by the saved provider's model list. Use **Refresh models** after changing the provider, or save the settings first; the list is read from the saved connection so the API key never has to leave the server. Example IDs are starting points, not a guarantee that a provider still offers them.

Thinking controls are a capability allowlist, not a live probe of the provider. A model ID gets a thinking control only when Agora knows the provider-specific parameter shape it accepts:

| Provider | Model IDs with thinking controls | Offered levels |
|---|---|---|
| OpenAI | `o1`–`o9` families, `gpt-5*`, `gpt-6*` | Provider default / Low / Medium / High |
| DeepSeek | `deepseek-flash`, `deepseek-v4-flash`, `deepseek-v4-pro`, `deepseek-reasoner` | Provider default / Off / Low / High / Max |
| xAI | IDs beginning `grok-` | Provider default / Low / Medium / High / Max |
| Anthropic | Claude 3.7 and later IDs in named or legacy form (`claude-sonnet-4-6`, `claude-3-7-sonnet`) | Provider default / Off / Low / Medium / High / Max; **Off** is hidden when thinking is always on |
| Google | Gemini 2.5 (`gemini-2.5-*`) uses a token budget; Gemini 3 and 4 (`gemini-3*`, `gemini-4*`) use thinking levels | Model-specific subset of Provider default / Off / Low / Medium / High / Max; the UI hides unsupported levels |
| OpenRouter | Models whose catalogue entry advertises reasoning metadata | Provider default / Off / the advertised effort levels; unsupported levels are hidden |
| Custom | None | No thinking control |
| No model | None | No thinking control |

The table is deliberately conservative. For OpenRouter, capabilities come from the provider's live catalogue rather than a hardcoded model-name rule, so new models can expose a control without an Agora release. OpenRouter's metadata is a declaration, not a live probe; **Refresh models** picks up changes. Other providers use the explicit rules above. A model that is not covered still works for authoring, chamber questions, and judgment; it runs with the provider’s default request shape and no thinking control. Model IDs returned by **Refresh models** are still primarily identifiers; for OpenRouter the same response also carries the reasoning metadata.

Compatibility is tested against current model families, not every ID a provider has ever offered. **Newer models are the supported path.** Older or retired IDs may fail even when the provider still lists them, and a thinking level of **Max** can fail or time out on some models. If that happens, use **Provider default** or a lower thinking level. The direct xAI/Grok path has not been live-tested; OpenRouter's xAI model routes stalled during testing.

For Claude, 4.6 and later use adaptive thinking with output effort; 3.7 through 4.5 use a thinking-token budget. For Gemini, 2.5 uses `thinkingBudget`; Gemini 3 and later use `thinkingLevel`, with **Max** only on models that accept XHIGH. **Off** is hidden where a model cannot disable thinking. Temperature is not sent while thinking is active; for models without a thinking control, temperature is the available generation control when a model ID is entered.

Custom endpoints do not get thinking controls because their parameter support cannot be verified. Use the endpoint’s default behavior.

Local models may expose their chain of thought in a separate `reasoning_content` field and spend much of the completion budget there before writing the final JSON. Agora gives loopback providers a 12,000-token output floor and up to five minutes for a generation. If the model still returns only hidden reasoning, Agora reports that clearly instead of treating the empty final content as a map.

`Save & test` saves the draft and sends a tiny completion request to the exact selected model; a reachable model list alone is not treated as success. It gives up after 15 seconds with a visible error. A key is stored locally in Agora's data folder as plain JSON (gitignored in a source checkout) and is never returned to the browser; the UI only learns whether a key exists.

Development runs can use environment fallbacks: `AGORA_LLM_BASE_URL`, `AGORA_LLM_MODEL`, `AGORA_LLM_REASONING_EFFORT`, `AGORA_LLM_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `DEEPSEEK_API_KEY`, and `OPENROUTER_API_KEY`. The packaged desktop build ignores ambient provider keys and `.env` files; enter the key in Settings. Copy `.env.example` to `.env` only for development; a saved settings file wins over the environment.
