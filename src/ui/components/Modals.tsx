import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Debate } from "../../core/model";
import type { UiSettings, ReasoningEffort } from "../api";
import { downloadArgdown, fetchArgdown, saveSettings, testSettings } from "../api";
import { applyThemePreference, readThemePreference, type ThemePreference } from "../theme";
import { isLocalProvider, providerHost, providerUrlProblem } from "../../shared/provider-url";

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

interface ModalProps {
  eyebrow?: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  wide?: "md" | "lg" | "xl";
  busy?: boolean;
}

export function Modal({ eyebrow, title, onClose, children, actions, wide = "md", busy }: ModalProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose, busy]);

  return (
    <div className={`modal-backdrop modal-backdrop--${wide}`} onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <div className={`modal modal--${wide}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <div>
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            <h2 className="modal-title">{title}</h2>
          </div>
          <button type="button" className="modal-close" onClick={onClose} disabled={busy} aria-label="Close">×</button>
        </header>
        <div className="modal-body">
          <div className="modal-scroll">{children}</div>
          {actions && <div className="modal-actions">{actions}</div>}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* New debate                                                          */
/* ------------------------------------------------------------------ */

const SAMPLES = [
  "I think cities should make public transit free at the point of use. Debate me.",
  "I think the four-day week should be the default full-time schedule. Debate me.",
  "I think social media platforms should be regulated like tobacco. Debate me.",
  "I think AI tutors will do more good than harm in schools. Debate me."
];

const BUILD_STEPS = [
  "Reading the position",
  "Finding the strongest case for it",
  "Building the strongest case against it",
  "Locating the real clash",
  "Laying out the map"
];

export function NewDebateModal({
  settings,
  onCreate,
  onClose,
  onOpenSettings
}: {
  settings: UiSettings | null;
  onCreate: (text: string) => Promise<void>;
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    areaRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!submitting) return;
    setStep(0);
    const timer = window.setInterval(() => setStep((value) => Math.min(BUILD_STEPS.length - 1, value + 1)), 3800);
    return () => window.clearInterval(timer);
  }, [submitting]);

  const submit = async () => {
    if (submitting || text.trim().length < 6) return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate(text.trim());
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not build the debate.");
      setSubmitting(false);
    }
  };

  return (
    <Modal
      eyebrow="New debate"
      title="Convene the chamber"
      onClose={onClose}
      busy={submitting}
      wide="lg"
      actions={!submitting ? (
        <>
          <div className="modal-note">
            {settings?.ready ? (
              <>Model: <b>{settings.model}</b></>
            ) : (
              <>Running locally. <button type="button" className="text-link" onClick={onOpenSettings}>Connect a model</button></>
            )}
          </div>
          <button type="button" className="btn btn--primary" onClick={submit} disabled={text.trim().length < 6}>
            Map the debate <span aria-hidden="true">→</span>
          </button>
        </>
      ) : null}
    >
      {submitting ? (
        <div className="build-state">
          <div className="build-glyph">
            <span className="build-ring" />
            <span className="build-ring build-ring--two" />
            <span className="build-dot" />
          </div>
          <div className="build-copy">
            <h3>Mapping the argument</h3>
            <p>{BUILD_STEPS[step]}…</p>
            <div className="build-steps">
              {BUILD_STEPS.map((label, index) => (
                <span key={label} className={index <= step ? "is-done" : ""}><i />{label}</span>
              ))}
            </div>
            <p className="build-note">
              {settings?.ready
                ? `Asking ${settings.model || "the model"} for a balanced map. This can take a minute.`
                : "Local reasoner: the map will be structural rather than topic-specific. Add a model in Settings for depth."}
            </p>
          </div>
        </div>
      ) : (
        <>
          <p className="modal-lede">
            State a position. Agora maps the strongest case for it, the strongest case against it, and the places
            where the two actually collide.
          </p>
          <label className="field">
            <span className="field-label">Your position</span>
            <textarea
              ref={areaRef}
              className="field-textarea field-textarea--large"
              placeholder="I think … Debate me."
              value={text}
              maxLength={4000}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submit();
              }}
            />
            <span className="field-count">{text.length.toLocaleString()} / 4,000</span>
          </label>
          <div className="sample-row">
            <span className="sample-label">Or take a position</span>
            <div className="sample-chips">
              {SAMPLES.map((sample) => (
                <button type="button" key={sample} className="sample-chip" onClick={() => {
                  setText(sample);
                  areaRef.current?.focus();
                }}>
                  {sample.split(".")[0]}
                </button>
              ))}
            </div>
          </div>
          {error && <div className="form-error">{error}</div>}
        </>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

const SAMPLE_ARGDOWN = `# The motion

[Cities should fund night buses]: Cities should fund a dense network of night buses.
  + <Night workers need it>
  - <The demand is too thin>

## For

<Night workers need it>: Hospitals, kitchens and warehouses run through the night.

(1) Hundreds of thousands of people finish work after midnight.
(2) Taxis are unaffordable for a large share of those workers.
----
(3) A city that runs at night needs a public way home.

## Against

<The demand is too thin>: Empty buses at 3am are expensive and polluting.

(1) Ridership outside peak hours is a small fraction of daytime demand.
(2) Vehicles and drivers still have to be paid for.
----
(3) Subsidising near-empty buses is a poor use of scarce transport money.
`;

export function ImportModal({
  onImport,
  onClose
}: {
  onImport: (source: string, motion?: string) => Promise<string[]>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"paste" | "file">("paste");
  const [source, setSource] = useState("");
  const [motion, setMotion] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<{ message: string; line?: number }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [dragging, setDragging] = useState(false);

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 1_500_000) {
      setError("That file is larger than 1.5 MB.");
      return;
    }
    const content = await file.text();
    setSource(content);
    setFileName(file.name);
    setError(null);
    setIssues([]);
  };

  const submit = async () => {
    if (!source.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    setIssues([]);
    try {
      await onImport(source, motion.trim() || undefined);
      onClose();
    } catch (caught) {
      const apiError = caught as { message?: string; issues?: { message: string; line?: number }[] };
      setError(apiError?.message ?? "Could not import that file.");
      setIssues(apiError?.issues ?? []);
      setSubmitting(false);
    }
  };

  return (
    <Modal
      eyebrow="Import"
      title="Bring an Argdown file into the chamber"
      onClose={onClose}
      busy={submitting}
      wide="lg"
      actions={
        <>
          <div className="modal-note">Parsed with the official <b>@argdown/core</b> parser. Premise structures are preserved.</div>
          <button type="button" className="btn btn--primary" onClick={submit} disabled={!source.trim() || submitting}>
            {submitting ? "Reading…" : "Import debate"} <span aria-hidden="true">→</span>
          </button>
        </>
      }
    >
      <div className="tab-row">
        <button type="button" className={mode === "paste" ? "tab is-active" : "tab"} onClick={() => setMode("paste")}>Paste source</button>
        <button type="button" className={mode === "file" ? "tab is-active" : "tab"} onClick={() => setMode("file")}>Upload a file</button>
        <button type="button" className="tab tab--sample" onClick={() => { setSource(SAMPLE_ARGDOWN); setMode("paste"); setError(null); }}>Use a sample</button>
      </div>

      {mode === "paste" ? (
        <label className="field">
          <span className="field-label">Argdown</span>
          <textarea
            className="field-textarea field-textarea--code"
            spellCheck={false}
            placeholder="[Your motion]: …&#10;&#10;<An argument>: …"
            value={source}
            onChange={(event) => setSource(event.target.value)}
          />
        </label>
      ) : (
        <div
          className={`dropzone ${dragging ? "is-dragging" : ""} ${fileName ? "has-file" : ""}`}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void readFile(event.dataTransfer.files[0]);
          }}
        >
          <input
            id="argdown-file"
            type="file"
            accept=".argdown,.ad,.md,.txt,text/plain"
            onChange={(event) => void readFile(event.target.files?.[0])}
          />
          <label htmlFor="argdown-file" className="dropzone-label">
            <span className="dropzone-icon">⇩</span>
            <b>{fileName ?? "Drop an .argdown file here"}</b>
            <span>{fileName ? "Click to choose a different file" : "or click to browse"}</span>
          </label>
        </div>
      )}

      <label className="field field--inline">
        <span className="field-label">Motion title <em>optional</em></span>
        <input
          type="text"
          className="field-input"
          placeholder="Leave blank to use the document's first heading or claim"
          value={motion}
          onChange={(event) => setMotion(event.target.value)}
        />
      </label>

      {error && (
        <div className="form-error">
          <p>{error}</p>
          {issues.length > 0 && (
            <ul>
              {issues.map((issue, index) => (
                <li key={`${issue.line}-${index}`}>
                  {issue.line ? <b>Line {issue.line}: </b> : null}{issue.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

export function ExportModal({ debate, onClose }: { debate: Debate; onClose: () => void }) {
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchArgdown(debate.id)
      .then((text) => {
        if (!cancelled) setSource(text);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not build the export.");
      });
    return () => { cancelled = true; };
  }, [debate.id]);

  const copy = async () => {
    if (!source) return;
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      const area = document.createElement("textarea");
      area.value = source;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    }
  };

  const filename = `${debate.motion.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "debate"}.argdown`;

  return (
    <Modal eyebrow="Export" title="Argdown source" onClose={onClose} wide="xl">
      <div className="export-grid">
        <div className="export-main">
          {error && <div className="form-error">{error}</div>}
          {!source && !error && <div className="export-loading">Building the source…</div>}
          {source && (
            <pre className="export-code"><code>{source}</code></pre>
          )}
          <div className="export-actions">
            <button type="button" className="btn btn--primary" onClick={copy} disabled={!source}>
              {copied ? "Copied ✓" : "Copy source"}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => void downloadArgdown(debate.id, filename)} disabled={!source}>
              Download .argdown
            </button>
            <a className="text-link" href="https://argdown.org/" target="_blank" rel="noreferrer">About Argdown</a>
          </div>
        </div>
        <aside className="export-side">
          <div className="export-stat"><b>{debate.nodes.length}</b><span>nodes</span></div>
          <div className="export-stat"><b>{debate.edges.length}</b><span>relations</span></div>
          <div className="export-stat">
            <b>{debate.nodes.filter((n) => n.stance === "pro").length} / {debate.nodes.filter((n) => n.stance === "con").length}</b>
            <span>for / against</span>
          </div>
          <div className="export-divider" />
          <p>
            The file defines every claim and argument with native Argdown relation syntax, so it opens directly in
            the Argdown sandbox, VS Code extension or CLI.
          </p>
          <p>
            Arguments carry native premise–conclusion structures, so their reasoning survives a round trip and is
            visible to the Argdown parser — not buried in comments.
          </p>
          <p className="export-tip">
            Tip: in the Argdown sandbox, click <b>Map</b> to render the official argument map. Our stage is a
            different reading of the same structure.
          </p>
        </aside>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

const PRESETS: { id: string; label: string; baseUrl: string; model: string; hint: string }[] = [
  { id: "local", label: "Local only", baseUrl: "", model: "", hint: "No model calls. Structural scaffolding only." },
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", hint: "An API key is required." },
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-flash", hint: "DeepSeek V4.1 Flash. Thinking effort is configurable below." },
  { id: "lmstudio", label: "LM Studio", baseUrl: "http://localhost:1234/v1", model: "local-model", hint: "Run the local server on port 1234. No key needed." },
  { id: "ollama", label: "Ollama", baseUrl: "http://localhost:11434/v1", model: "llama3.2", hint: "Start Ollama with an OpenAI-compatible endpoint. No key needed." },
  { id: "custom", label: "Custom", baseUrl: "", model: "", hint: "Any OpenAI-compatible chat-completions endpoint." }
];

const EFFORT_OPTIONS: { id: ReasoningEffort; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "low", label: "Low" },
  { id: "high", label: "High" },
  { id: "max", label: "Max" }
];

export function SettingsModal({
  settings,
  onSaved,
  onClose
}: {
  settings: UiSettings;
  onSaved: (settings: UiSettings) => void;
  onClose: () => void;
}) {
  const initialPreset = PRESETS.find((preset) => preset.id === settings.provider) ?? PRESETS.find((preset) => preset.id === "custom")!;
  const [provider, setProvider] = useState(settings.provider || "custom");
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [model, setModel] = useState(settings.model);
  const [apiKey, setApiKey] = useState("");
  const [temperature, setTemperature] = useState(settings.temperature);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(settings.reasoningEffort ?? "high");
  const [theme, setTheme] = useState<ThemePreference>(() => readThemePreference());
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forgetKey, setForgetKey] = useState(false);
  const hasEffectiveKey = Boolean(apiKey.trim()) || (!forgetKey && settings.hasKey);
  const urlProblem = providerUrlProblem(baseUrl, hasEffectiveKey);
  const providerIsLocal = isLocalProvider(baseUrl);
  const providerDestination = providerHost(baseUrl);

  const choosePreset = (id: string) => {
    setProvider(id);
    const preset = PRESETS.find((item) => item.id === id);
    if (preset && id !== "custom") {
      setBaseUrl(preset.baseUrl);
      setModel(preset.model);
    }
    if (id === "deepseek") setReasoningEffort("high");
    setStatus(null);
  };

  const persist = async (alsoTest: boolean) => {
    setError(null);
    setStatus(null);
    if (urlProblem) {
      setError(urlProblem);
      return;
    }
    if (alsoTest) setTesting(true);
    else setSaving(true);
    try {
      const payload: Parameters<typeof saveSettings>[0] = {
        provider,
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        temperature,
        reasoningEffort
      };
      if (apiKey.trim()) payload.apiKey = apiKey.trim();
      if (forgetKey) payload.apiKey = "";
      const result = await saveSettings(payload);
      onSaved(result.settings);
      setApiKey("");
      setForgetKey(false);
      if (alsoTest) {
        const test = await testSettings();
        setStatus({ ok: test.ok, message: test.message });
      } else {
        setStatus({ ok: true, message: "Saved." });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save settings.");
    } finally {
      setSaving(false);
      setTesting(false);
    }
  };

  return (
    <Modal
      eyebrow="Settings"
      title="Model & keys"
      onClose={onClose}
      busy={saving || testing}
      wide="lg"
      actions={
        <>
          <div className="modal-note">
            {initialPreset.id !== "custom" && settings.ready ? `Currently using ${settings.model}.` : "Local reasoner active until a model is connected."}
            <span className="settings-version">Agora {__APP_VERSION__}</span>
          </div>
          <div className="modal-action-group">
            <button type="button" className="btn btn--ghost" onClick={() => void persist(true)} disabled={saving || testing || Boolean(urlProblem)}>
              {testing ? "Testing…" : "Save & test"}
            </button>
            <button type="button" className="btn btn--primary" onClick={() => void persist(false)} disabled={saving || testing || Boolean(urlProblem)}>
              {saving ? "Saving…" : "Save settings"}
            </button>
          </div>
        </>
      }
    >
      <p className="modal-lede">
        Agora speaks to any OpenAI-compatible chat-completions endpoint. The local scaffolder is always available;
        a model makes the arguments topic-specific.
      </p>
      <p className="modal-note modal-note--privacy">
        When a model is connected, the motion, argument text, chat messages, and judgment context you submit are
        sent to the provider above. There is no remote Agora service, telemetry, crash reporting, or auto-update.
      </p>
      {settings.source === "env" && (
        <p className="modal-note modal-note--privacy">
          Provider settings are coming from environment variables. Entering a provider here overrides them.
        </p>
      )}

      <div className="field field--appearance">
        <span className="field-label">
          Appearance <em>saved on this machine</em>
        </span>
        <div className="judge-segmented appearance-segmented">
          {(["system", "light", "dark"] as const).map((option) => (
            <button
              type="button"
              key={option}
              className={`judge-segment ${theme === option ? "is-selected" : ""}`}
              aria-pressed={theme === option}
              onClick={() => {
                setTheme(option);
                applyThemePreference(option);
              }}
            >
              {option === "system" ? "System" : option === "light" ? "Light" : "Dark"}
            </button>
          ))}
        </div>
        <span className="field-hint">
          System follows the Windows appearance setting. The choice applies immediately and is remembered.
        </span>
      </div>

      <div className="preset-grid">
        {PRESETS.map((preset) => (
          <button
            type="button"
            key={preset.id}
            className={`preset ${provider === preset.id ? "is-active" : ""}`}
            onClick={() => choosePreset(preset.id)}
          >
            <b>{preset.label}</b>
            <span>{preset.hint}</span>
          </button>
        ))}
      </div>

      <div className="settings-grid">
        <label className="field">
          <span className="field-label">Base URL</span>
          <input
            type="text"
            className="field-input"
            placeholder="https://api.openai.com/v1"
            value={baseUrl}
            onChange={(event) => { setBaseUrl(event.target.value); setStatus(null); }}
            disabled={provider === "local"}
          />
          {urlProblem && <span className="field-hint field-hint--error">{urlProblem}</span>}
          {!urlProblem && baseUrl.trim() && !providerIsLocal && (
            <span className="field-hint">
              Requests and argument text go to <b>{providerDestination}</b>. {hasEffectiveKey ? "Your API key is sent there." : "Add a key below if this provider requires one."}
            </span>
          )}
          {!urlProblem && providerIsLocal && (
            <span className="field-hint">Local provider. Requests stay on this machine.</span>
          )}
        </label>
        <label className="field">
          <span className="field-label">Model</span>
          <input
            type="text"
            className="field-input"
            placeholder="gpt-4o-mini"
            value={model}
            onChange={(event) => { setModel(event.target.value); setStatus(null); }}
            disabled={provider === "local"}
          />
        </label>
      </div>

      <label className="field">
        <span className="field-label">
          API key <em>{settings.hasKey ? "saved" : "optional for local servers"}</em>
        </span>
        <input
          type="password"
          className="field-input"
          placeholder={settings.hasKey ? "•••••••• saved — leave blank to keep" : "sk-…"}
          value={apiKey}
          onChange={(event) => { setApiKey(event.target.value); setForgetKey(false); }}
          autoComplete="off"
        />
        <div className="key-row">
          <span className="field-hint">
            Stored locally in Agora's data folder as plain JSON. The server never returns it to the browser;
            it is sent only to the provider above.
          </span>
          {settings.hasKey && (
            <button
              type="button"
              className={`text-link ${forgetKey ? "is-danger" : ""}`}
              onClick={() => setForgetKey((value) => !value)}
            >
              {forgetKey ? "Key will be removed" : "Forget saved key"}
            </button>
          )}
        </div>
      </label>

      {provider === "deepseek" && (
        <div className="field">
          <span className="field-label">
            Reasoning effort <em>DeepSeek thinking</em>
          </span>
          <div className="judge-segmented">
            {EFFORT_OPTIONS.map((option) => (
              <button
                type="button"
                key={option.id}
                className={`judge-segment ${reasoningEffort === option.id ? "is-selected" : ""}`}
                aria-pressed={reasoningEffort === option.id}
                onClick={() => { setReasoningEffort(option.id); setStatus(null); }}
              >
                {option.label}
              </button>
            ))}
          </div>
          <span className="field-hint">
            {reasoningEffort === "off"
              ? "Thinking disabled. Fastest option; the authoring JSON uses the normal output budget."
              : `Thinking enabled at ${reasoningEffort} effort. Higher effort takes longer and costs more, but can improve difficult judgments.`}
          </span>
        </div>
      )}

      <label className="field">
        <span className="field-label">Temperature <em>{temperature.toFixed(2)}</em></span>
        <input
          type="range"
          className="range"
          min={0.2}
          max={1.1}
          step={0.05}
          value={temperature}
          disabled={provider === "deepseek"}
          onChange={(event) => setTemperature(Number(event.target.value))}
        />
        <span className="field-hint">
          {provider === "deepseek"
            ? "DeepSeek Flash ignores temperature; use reasoning effort to control its depth."
            : "Lower is more literal; higher produces more varied maps and rebuttals."}
        </span>
      </label>

      {status && (
        <div className={`settings-status ${status.ok ? "is-ok" : "is-bad"}`}>
          <span>{status.ok ? "●" : "●"}</span> {status.message}
        </div>
      )}
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Confirm delete                                                      */
/* ------------------------------------------------------------------ */

export function ConfirmModal({
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      eyebrow="Confirm"
      title={title}
      onClose={onClose}
      busy={busy}
      wide="md"
      actions={
        <>
          <div className="modal-note">This cannot be undone.</div>
          <div className="modal-action-group">
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="btn btn--danger" disabled={busy} onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onClose();
              } finally {
                setBusy(false);
              }
            }}>
              {busy ? "Removing…" : confirmLabel}
            </button>
          </div>
        </>
      }
    >
      <p className="modal-lede">{message}</p>
    </Modal>
  );
}
