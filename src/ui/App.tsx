import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Debate, DebateSummary } from "../core/model";
import { message } from "../core/model";
import { randomSeed, stageDebate, type StagedDebate } from "../core/stage";
import {
  judgmentMarkdown,
  motionOutcomeForDisplay,
  OUTCOME_SHORT,
  solveJudgment,
  type JudgmentRun
} from "../core/judgment";
import {
  createDebate,
  deleteDebate,
  fetchDebate,
  fetchDebates,
  fetchSettings,
  importArgdown,
  judgeDebate,
  sendChat,
  type UiSettings
} from "./api";
import { DebateGraph } from "./components/DebateGraph";
import type { GraphHandle, GraphJudgment, GraphStage } from "./components/DebateGraph";
import { ChatPanel } from "./components/ChatPanel";
import { StagePanel } from "./components/StagePanel";
import { NodeInspector } from "./components/NodeInspector";
import { JudgmentPanel } from "./components/JudgmentPanel";
import { JudgmentModal, type JudgeRunInput } from "./components/JudgmentModal";
import { ConfirmModal, ExportModal, ImportModal, NewDebateModal, SettingsModal } from "./components/Modals";

type ModalKind = "new" | "import" | "export" | "settings" | "judge" | null;

interface StageState {
  transcript: StagedDebate;
  index: number;
  playing: boolean;
  speed: number;
  voice: boolean;
}

interface JudgmentState {
  run: JudgmentRun;
  step: number;
  playing: boolean;
  speed: number;
}

const ACTIVE_KEY = "agora.active";

function timeAgo(timestamp: number): string {
  const seconds = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function App() {
  const [summaries, setSummaries] = useState<DebateSummary[]>([]);
  const [debate, setDebate] = useState<Debate | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [settings, setSettings] = useState<UiSettings | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [loadingDebate, setLoadingDebate] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalKind>(null);
  const [deleteTarget, setDeleteTarget] = useState<DebateSummary | null>(null);
  const [toast, setToast] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);
  const [stage, setStage] = useState<StageState | null>(null);
  const [judgment, setJudgment] = useState<JudgmentState | null>(null);
  const [restored, setRestored] = useState<string[]>([]);
  const [focusMap, setFocusMap] = useState(false);
  const graphRef = useRef<GraphHandle | null>(null);
  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((text: string, tone: "ok" | "warn" | "error" = "ok") => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ text, tone });
    toastTimer.current = window.setTimeout(() => setToast(null), 5200);
  }, []);

  const refreshSummaries = useCallback(async () => {
    try {
      const response = await fetchDebates();
      setSummaries(response.debates);
    } catch {
      /* summaries are cosmetic; the active debate still works */
    }
  }, []);

  const loadDebate = useCallback(async (id: string) => {
    setLoadingDebate(true);
    try {
      const response = await fetchDebate(id);
      setDebate(response.debate);
      setActiveId(id);
      setSelectedId(null);
      setStage(null);
      setJudgment(null);
      setRestored([]);
      localStorage.setItem(ACTIVE_KEY, id);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not open that debate.", "error");
    } finally {
      setLoadingDebate(false);
      setInitializing(false);
    }
  }, [showToast]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [debateResponse, settingsResponse] = await Promise.all([fetchDebates(), fetchSettings()]);
        if (cancelled) return;
        setSummaries(debateResponse.debates);
        setSettings(settingsResponse.settings);
        const stored = localStorage.getItem(ACTIVE_KEY);
        const first = debateResponse.debates.find((item) => item.id === stored) ?? debateResponse.debates[0];
        if (first) {
          await loadDebate(first.id);
        } else {
          setInitializing(false);
        }
      } catch (error) {
        if (!cancelled) {
          showToast(error instanceof Error ? error.message : "Could not reach the server.", "error");
          setInitializing(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadDebate, showToast]);

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  useEffect(() => {
    if (!focusMap) return;
    const timer = window.setTimeout(() => graphRef.current?.fit(), 480);
    return () => window.clearTimeout(timer);
  }, [focusMap]);

  useEffect(() => {
    if (!focusMap) {
      const timer = window.setTimeout(() => graphRef.current?.smart(), 260);
      return () => window.clearTimeout(timer);
    }
  }, [focusMap]);

  const selectedNode = useMemo(
    () => (debate && selectedId ? debate.nodes.find((node) => node.id === selectedId) ?? null : null),
    [debate, selectedId]
  );

  const appliedVerdicts = useMemo(
    () => (judgment ? judgment.run.verdicts.slice(0, judgment.step) : []),
    [judgment?.run, judgment?.step]
  );

  const judgmentSnapshot = useMemo(
    () => (debate && judgment ? solveJudgment(debate, appliedVerdicts, judgment.run.standard, judgment.run.assessments) : null),
    [debate, judgment, appliedVerdicts]
  );

  const judgmentComplete = Boolean(
    judgment && judgment.step >= judgment.run.verdicts.length
  );

  const restoredNow = useMemo(() => {
    if (!judgment || !debate || judgment.step <= 0 || !judgmentSnapshot) return [] as string[];
    const before = solveJudgment(debate, judgment.run.verdicts.slice(0, judgment.step - 1), judgment.run.standard, judgment.run.assessments).statuses;
    return Object.keys(judgmentSnapshot.statuses).filter(
      (id) => before[id] === "defeated" && judgmentSnapshot.statuses[id] !== "defeated"
    );
  }, [debate, judgment?.run, judgment?.step, judgmentSnapshot]);

  useEffect(() => {
    setRestored(restoredNow);
  }, [restoredNow.join("|"), judgment?.step]);

  const judgmentGraph: GraphJudgment | undefined = useMemo(() => {
    if (!judgment || !judgmentSnapshot) return undefined;
    const current = judgment.step > 0 ? judgment.run.verdicts[judgment.step - 1] : undefined;
    const verdictByEdge: GraphJudgment["verdictByEdge"] = {};
    for (const verdict of appliedVerdicts) verdictByEdge[verdict.edgeId] = verdict.verdict;
    const settled = judgmentComplete;
    const motion = motionOutcomeForDisplay({
      standard: judgment.run.standard,
      step: judgment.step,
      complete: settled,
      outcome: judgmentSnapshot.outcome
    });
    return {
      active: true,
      statuses: judgment.step > 0 || settled ? judgmentSnapshot.statuses : {},
      activeEdgeId: settled ? undefined : current?.edgeId,
      activeNodeIds: settled || !current ? [] : [current.from, current.to],
      reinstated: restored,
      verdictByEdge,
      complete: settled,
      outcome: settled ? judgmentSnapshot.outcome : undefined,
      motionDisposition: motion.outcome,
      motionProvisional: motion.provisional,
      unsupportedThesis: settled && judgmentSnapshot.unsupportedThesis
    };
  }, [judgment, judgmentSnapshot, judgmentComplete, appliedVerdicts, restored]);

  const openStage = useCallback(() => {
    if (!debate) return;
    const transcript = stageDebate(debate, randomSeed());
    setJudgment(null);
    setRestored([]);
    setSelectedId(null);
    setStage({ transcript, index: 0, playing: true, speed: 1, voice: false });
  }, [debate]);

  const closeStage = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setStage(null);
  }, []);

  const restartStage = useCallback(() => {
    setStage((current) => current ? { ...current, index: 0, playing: true } : current);
  }, []);

  const shuffleStage = useCallback(() => {
    if (!debate) return;
    const transcript = stageDebate(debate, randomSeed());
    setStage((current) => current ? { ...current, transcript, index: 0, playing: true } : current);
  }, [debate]);

  const togglePlay = useCallback(() => {
    setStage((current) => {
      if (!current) return current;
      const atEnd = current.index >= current.transcript.turns.length - 1;
      if (atEnd && !current.playing) return { ...current, index: 0, playing: true };
      return { ...current, playing: !current.playing };
    });
  }, []);

  const nextTurn = useCallback(() => {
    setStage((current) => {
      if (!current) return current;
      if (current.index >= current.transcript.turns.length - 1) return { ...current, playing: false };
      return { ...current, index: current.index + 1, playing: false };
    });
  }, []);

  const openJudgmentSetup = useCallback(() => {
    if (!debate) return;
    if (stage) closeStage();
    setFocusMap(false);
    setSelectedId(null);
    setModal("judge");
  }, [debate, stage, closeStage]);

  const conveneJudgment = useCallback(async (input: JudgeRunInput) => {
    if (!debate) throw new Error("Open a debate before convening the bench.");
    const response = await judgeDebate(debate.id, input);
    setRestored([]);
    setStage(null);
    setSelectedId(null);
    setJudgment({ run: response.run, step: 0, playing: true, speed: 1 });
    setModal(null);
    showToast(
      response.run.engine === "local"
        ? "Structural review in session. Connect a model for substantive rulings."
        : "The bench is in session.",
      response.run.engine === "local" ? "warn" : "ok"
    );
  }, [debate, showToast]);

  const closeJudgment = useCallback(() => {
    setJudgment(null);
    setRestored([]);
    setSelectedId(null);
  }, []);

  const toggleJudgmentPlay = useCallback(() => {
    setJudgment((current) => {
      if (!current) return current;
      const total = current.run.verdicts.length;
      if (current.step >= total) return { ...current, step: 0, playing: true };
      return { ...current, playing: !current.playing };
    });
  }, []);

  const nextRuling = useCallback(() => {
    setJudgment((current) => {
      if (!current) return current;
      if (current.step >= current.run.verdicts.length) return { ...current, playing: false };
      return { ...current, step: current.step + 1, playing: false };
    });
  }, []);

  const previousRuling = useCallback(() => {
    setJudgment((current) => {
      if (!current) return current;
      return { ...current, step: Math.max(0, current.step - 1), playing: false };
    });
  }, []);

  const restartJudgment = useCallback(() => {
    setJudgment((current) => current ? { ...current, step: 0, playing: true } : current);
  }, []);

  const seekRuling = useCallback((step: number) => {
    setJudgment((current) => {
      if (!current) return current;
      return { ...current, step: Math.max(0, Math.min(current.run.verdicts.length, step)), playing: false };
    });
  }, []);

  const saveJudgmentReport = useCallback(() => {
    if (!debate || !judgment) return;
    const markdown = judgmentMarkdown(debate, judgment.run);
    const slug = debate.motion.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 54) || "debate";
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `judgment-${slug}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("Judgment report saved.");
  }, [debate, judgment, showToast]);

  useEffect(() => {
    if (!judgment?.playing) return;
    const total = judgment.run.verdicts.length;
    if (total === 0 || judgment.step >= total) {
      setJudgment((current) => current ? { ...current, playing: false } : current);
      return;
    }
    const delay = (judgment.step === 0 ? 2100 : 5200) / judgment.speed;
    const timer = window.setTimeout(() => {
      setJudgment((current) => {
        if (!current || !current.playing) return current;
        return { ...current, step: Math.min(current.run.verdicts.length, current.step + 1) };
      });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [judgment?.playing, judgment?.step, judgment?.speed, judgment?.run.verdicts.length]);

  useEffect(() => {
    if (!judgment || modal) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.code === "Space") {
        if (target?.tagName === "BUTTON") return;
        event.preventDefault();
        toggleJudgmentPlay();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        nextRuling();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        previousRuling();
      } else if (event.key === "Escape" && !selectedId) {
        closeJudgment();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [judgment, selectedId, modal, toggleJudgmentPlay, nextRuling, previousRuling, closeJudgment]);

  useEffect(() => {
    if (!stage?.playing) return;
    const turn = stage.transcript.turns[stage.index];
    if (!turn) return;
    const delay = (turn.duration + 650) / stage.speed;
    const timer = window.setTimeout(() => {
      setStage((current) => {
        if (!current || !current.playing) return current;
        if (current.index >= current.transcript.turns.length - 1) return { ...current, playing: false };
        return { ...current, index: current.index + 1 };
      });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [stage?.playing, stage?.index, stage?.speed, stage?.transcript]);

  useEffect(() => {
    if (!stage || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    if (!stage.voice || !stage.playing) return;
    const turn = stage.transcript.turns[stage.index];
    if (!turn) return;
    const utterance = new SpeechSynthesisUtterance(turn.text);
    utterance.rate = Math.min(1.7, 0.96 * stage.speed);
    utterance.pitch = turn.speaker === "challenger" ? 0.94 : turn.speaker === "advocate" ? 1.04 : 1;
    const voices = synth.getVoices().filter((voice) => voice.lang.toLowerCase().startsWith("en"));
    if (voices.length) {
      utterance.voice = turn.speaker === "challenger" ? voices[Math.min(1, voices.length - 1)]! : voices[0]!;
    }
    synth.speak(utterance);
    return () => synth.cancel();
  }, [stage?.voice, stage?.playing, stage?.index, stage?.speed, stage?.transcript]);

  useEffect(() => {
    if (!stage) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.code === "Space") {
        event.preventDefault();
        togglePlay();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        nextTurn();
      } else if (event.key === "Escape") {
        closeStage();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, togglePlay, nextTurn, closeStage]);

  const stageGraph: GraphStage | undefined = useMemo(() => {
    if (!stage || !debate) return undefined;
    const turns = stage.transcript.turns;
    const upto = turns.slice(0, stage.index + 1);
    const revealed = new Set<string>();
    for (const turn of upto) for (const id of turn.reveal) revealed.add(id);
    let focusId: string | undefined;
    for (let i = Math.min(stage.index, turns.length - 1); i >= 0; i -= 1) {
      if (turns[i]?.nodeId) {
        focusId = turns[i]!.nodeId;
        break;
      }
    }
    return {
      active: true,
      revealed,
      focusId,
      litEdges: new Set(turns[stage.index]?.litEdges ?? []),
      turnKey: `${stage.transcript.seed}-${stage.index}`
    };
  }, [stage?.index, stage?.transcript, debate]);

  const handleCreate = useCallback(async (text: string) => {
    const result = await createDebate(text);
    setDebate(result.debate);
    setActiveId(result.debate.id);
    setSelectedId(null);
    setJudgment(null);
    setRestored([]);
    localStorage.setItem(ACTIVE_KEY, result.debate.id);
    await refreshSummaries();
    if (result.warning) {
      showToast(result.warning, "warn");
    } else if (result.engine === "local") {
      showToast("Mapped locally. Connect a model in Settings for topic-specific depth.", "warn");
    } else {
      showToast("The map is on the table.", "ok");
    }
  }, [refreshSummaries, showToast]);

  const handleImport = useCallback(async (source: string, motion?: string) => {
    const result = await importArgdown(source, motion);
    setDebate(result.debate);
    setActiveId(result.debate.id);
    setSelectedId(null);
    setJudgment(null);
    setRestored([]);
    localStorage.setItem(ACTIVE_KEY, result.debate.id);
    await refreshSummaries();
    showToast(result.warnings[0] ?? "Argdown imported.", result.warnings.length ? "warn" : "ok");
    return result.warnings;
  }, [refreshSummaries, showToast]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || !debate || chatBusy) return;
    setDraft("");
    setChatBusy(true);
    setDebate((current) => current ? { ...current, chat: [...current.chat, message("user", text)] } : current);
    try {
      const result = await sendChat(debate.id, text);
      setDebate(result.debate);
      setSelectedId(null);
      void refreshSummaries();
      if (result.warning) showToast(result.warning, "warn");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The chamber did not answer.", "error");
      const fresh = await fetchDebate(debate.id).catch(() => null);
      if (fresh) setDebate(fresh.debate);
    } finally {
      setChatBusy(false);
    }
  }, [draft, debate, chatBusy, refreshSummaries, showToast]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    try {
      await deleteDebate(target.id);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not remove the debate.", "error");
      return;
    }
    const remaining = summaries.filter((item) => item.id !== target.id);
    setSummaries(remaining);
    setDeleteTarget(null);
    if (activeId === target.id) {
      if (remaining[0]) await loadDebate(remaining[0].id);
      else {
        setDebate(null);
        setActiveId(null);
        localStorage.removeItem(ACTIVE_KEY);
      }
    }
    showToast("Debate removed.");
  }, [deleteTarget, summaries, activeId, loadDebate, showToast]);

  const askAbout = useCallback((prompt: string) => {
    setSelectedId(null);
    setDraft(prompt);
    requestAnimationFrame(() => document.getElementById("chamber-input")?.focus());
  }, []);

  if (initializing) {
    return (
      <div className="splash">
        <div className="splash-mark">A</div>
        <div className="splash-word">AGORA</div>
        <div className="splash-line"><i /></div>
        <p>Opening the chamber</p>
      </div>
    );
  }

  const counts = debate
    ? {
        pro: debate.nodes.filter((node) => node.stance === "pro").length,
        con: debate.nodes.filter((node) => node.stance === "con").length
      }
    : { pro: 0, con: 0 };

  return (
    <div className={`app ${stage ? "has-stage" : ""} ${focusMap ? "focus-map" : ""} ${judgment ? "is-judging" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 28 28" width="24" height="24">
              <path d="M4 24h20M6 24V9h16v15M9 24V13M14 24V13M19 24V13M4 9h20M8 6h12M11 3h6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </span>
          <span className="brand-text">
            <b>AGORA</b>
            <i>debate harness</i>
          </span>
        </div>

        <div className="topbar-center">
          <span className="topbar-rule" />
          <p>
            {judgment
              ? judgmentComplete
                ? "The record is closed. The reasons remain."
                : "The bench is in session. Follow the reasoning."
              : "Every argument has a shape. Find it, then argue with it."}
          </p>
          <span className="topbar-rule" />
        </div>

        <div className="topbar-actions">
          <button
            type="button"
            className="btn btn--quiet btn--focus"
            onClick={() => setFocusMap((value) => !value)}
            disabled={Boolean(judgment)}
            title={judgment ? "Exit judgment to change the room" : focusMap ? "Show library and chamber" : "Give the map the whole room"}
          >
            {focusMap ? (
              <svg viewBox="0 0 18 18" width="15" height="15" aria-hidden="true"><path d="M7 2H2v5M11 16h5v-5M16 7V2h-5M2 11v5h5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            ) : (
              <svg viewBox="0 0 18 18" width="15" height="15" aria-hidden="true"><path d="M2 7V2h5M16 11v5h-5M16 7V2h-5M2 11v5h5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            )}
            {focusMap ? "Exit focus" : "Focus"}
          </button>
          <button type="button" className="btn btn--quiet" onClick={() => setModal("import")} disabled={Boolean(judgment)} title="Import Argdown">
            <svg viewBox="0 0 18 18" width="15" height="15" aria-hidden="true"><path d="M9 2v9M5.5 7.5 9 11l3.5-3.5M3 13.5V16h12v-2.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Import
          </button>
          <button type="button" className="btn btn--quiet" onClick={() => debate && setModal("export")} disabled={!debate} title="Export Argdown">
            <svg viewBox="0 0 18 18" width="15" height="15" aria-hidden="true"><path d="M9 11V2M5.5 5.5 9 2l3.5 3.5M3 13.5V16h12v-2.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Export
          </button>
          <button
            type="button"
            className={`btn btn--judge ${judgment ? "is-active" : ""}`}
            onClick={openJudgmentSetup}
            disabled={!debate || Boolean(judgment)}
            title={judgment ? "The bench is in session" : "Convene a judgment on this map"}
          >
            <svg viewBox="0 0 18 18" width="15" height="15" aria-hidden="true">
              <path d="M9 2v13M5 15h8M4 5h10M4 5 2 10h4L4 5zm10 0-2 5h4l-2-5z" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {judgment ? "Judging" : "Judge"}
          </button>
          <button type="button" className="btn btn--stage" onClick={openStage} disabled={!debate || Boolean(judgment)}>
            <svg viewBox="0 0 18 18" width="14" height="14" aria-hidden="true"><path d="M5 3.5 14 9l-9 5.5z" fill="currentColor"/></svg>
            Stage debate
          </button>
          <button type="button" className="icon-btn topbar-settings" onClick={() => setModal("settings")} aria-label="Settings" title="Settings">
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M10 6.7a3.3 3.3 0 1 0 0 6.6 3.3 3.3 0 0 0 0-6.6zM16.2 11.2l1.3 1-.9 1.6-1.6-.4a6 6 0 0 1-1.4 1.4l.4 1.6-1.6.9-1-1.3a6 6 0 0 1-2 0l-1 1.3-1.6-.9.4-1.6a6 6 0 0 1-1.4-1.4l-1.6.4-.9-1.6 1.3-1a6 6 0 0 1 0-2l-1.3-1 .9-1.6 1.6.4a6 6 0 0 1 1.4-1.4l-.4-1.6 1.6-.9 1 1.3a6 6 0 0 1 2 0l1-1.3 1.6.9-.4 1.6a6 6 0 0 1 1.4 1.4l1.6-.4.9 1.6-1.3 1a6 6 0 0 1 0 2z" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/></svg>
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="library" aria-label="Debate library">
          <div className="library-head">
            <div>
              <div className="eyebrow">The library</div>
              <h2>{summaries.length} {summaries.length === 1 ? "debate" : "debates"}</h2>
            </div>
            <button type="button" className="library-new" onClick={() => setModal("new")} aria-label="New debate" title="New debate">+</button>
          </div>

          <div className="library-list">
            {summaries.map((item) => (
              <div key={item.id} className={`library-card ${item.id === activeId ? "is-active" : ""}`}>
                <button
                  type="button"
                  className="library-card-main"
                  onClick={() => item.id !== activeId && loadDebate(item.id)}
                >
                  <span className="library-card-motion">{item.motion}</span>
                  <span className="library-card-thesis">{item.thesisText}</span>
                  <span className="library-card-meta">
                    {item.nodeCount} nodes <i>·</i> {timeAgo(item.updatedAt)}
                    {item.origin === "imported" && <em>imported</em>}
                    {item.origin === "seed" && <em>demo</em>}
                  </span>
                </button>
                <button
                  type="button"
                  className="library-delete"
                  onClick={() => setDeleteTarget(item)}
                  aria-label={`Delete ${item.motion}`}
                  title="Delete debate"
                >×</button>
              </div>
            ))}
            {summaries.length === 0 && (
              <div className="library-empty">
                <p>No motions on the floor.</p>
                <button type="button" className="text-link" onClick={() => setModal("new")}>Convene the first debate</button>
              </div>
            )}
          </div>

          <div className="library-foot">
            <div className={`status-line ${settings?.ready ? "is-ready" : ""}`}>
              <span className="status-dot" />
              <span>{settings?.ready ? settings.model || "Model connected" : "Local reasoner"}</span>
            </div>
            <p>Debates are stored as plain JSON on this machine.</p>
          </div>
        </aside>

        <main className={`canvas ${loadingDebate ? "is-loading" : ""}`}>
          <div className="canvas-head">
            <div className="canvas-heading">
              <div className="eyebrow">{judgment ? "Judgment · the bench" : "Argument map"}</div>
              {debate ? (
                <h1 className="canvas-motion">{debate.motion}</h1>
              ) : (
                <h1 className="canvas-motion">No motion on the floor</h1>
              )}
              {debate && <p className="canvas-sub">{debate.thesisText}</p>}
            </div>
            {debate && (
              judgment && judgmentSnapshot ? (
                <div className="canvas-stats canvas-stats--judgment">
                  {judgment.step > 0 || judgmentComplete ? (
                    <>
                      <span><b>{judgmentSnapshot.counts.standing}</b> standing</span>
                      <span><b>{judgmentSnapshot.counts.defeated}</b> defeated</span>
                      <span><b>{judgmentSnapshot.counts.contested}</b> contested</span>
                    </>
                  ) : (
                    <span>The bench is reading</span>
                  )}
                  <span className={`judgment-state-tag ${judgmentComplete ? `judgment-state-tag--${judgmentSnapshot.outcome}` : ""}`}>
                    {judgmentComplete ? OUTCOME_SHORT[judgmentSnapshot.outcome] : "In session"}
                  </span>
                </div>
              ) : (
                <div className="canvas-stats">
                  <span><b>{debate.nodes.length}</b> nodes</span>
                  <span><b>{debate.edges.length}</b> relations</span>
                  <span className="canvas-split"><i className="score-dot score-dot--pro" />{counts.pro} <i className="score-dot score-dot--con" />{counts.con}</span>
                  <span className={`origin-tag origin-tag--${debate.origin}`}>
                    {debate.origin === "imported" ? "Imported" : debate.origin === "seed" ? "Reference map" : "Authored"}
                  </span>
                </div>
              )
            )}
          </div>

          <div className="canvas-body">
            {debate ? (
              <>
                <DebateGraph
                  ref={graphRef}
                  debate={debate}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  stage={stageGraph}
                  judgment={judgmentGraph}
                />
                {selectedNode && (
                  <NodeInspector
                    debate={debate}
                    node={selectedNode}
                    onClose={() => setSelectedId(null)}
                    onAsk={askAbout}
                  />
                )}
              </>
            ) : (
              <div className="empty-canvas">
                <div className="empty-glyph">∴</div>
                <h2>Start with a position.</h2>
                <p>Agora turns a sentence into a map of arguments, then lets you stage the fight.</p>
                <button type="button" className="btn btn--primary" onClick={() => setModal("new")}>
                  Convene a debate
                </button>
              </div>
            )}
            {loadingDebate && <div className="canvas-loading"><span /></div>}
          </div>
        </main>

        {judgment && debate && judgmentSnapshot ? (
          <JudgmentPanel
            debate={debate}
            run={judgment.run}
            step={judgment.step}
            playing={judgment.playing}
            speed={judgment.speed}
            snapshot={judgmentSnapshot}
            restored={restored}
            onTogglePlay={toggleJudgmentPlay}
            onNext={nextRuling}
            onPrevious={previousRuling}
            onRestart={restartJudgment}
            onSeek={seekRuling}
            onSpeedChange={(speed) => setJudgment((current) => current ? { ...current, speed } : current)}
            onExit={closeJudgment}
            onNewRun={() => setModal("judge")}
            onOpenSettings={() => setModal("settings")}
            onReport={saveJudgmentReport}
          />
        ) : (
          <ChatPanel
            debate={debate}
            settings={settings}
            busy={chatBusy}
            draft={draft}
            onDraftChange={setDraft}
            onSend={() => void handleSend()}
            onOpenSettings={() => setModal("settings")}
          />
        )}
      </div>

      {stage && debate && (
        <StagePanel
          transcript={stage.transcript}
          motion={debate.motion}
          index={stage.index}
          playing={stage.playing}
          speed={stage.speed}
          voice={stage.voice}
          onTogglePlay={togglePlay}
          onNext={nextTurn}
          onRestart={restartStage}
          onShuffle={shuffleStage}
          onClose={closeStage}
          onSpeedChange={(speed) => setStage((current) => current ? { ...current, speed } : current)}
          onToggleVoice={() => setStage((current) => current ? { ...current, voice: !current.voice } : current)}
        />
      )}

      {toast && (
        <div className={`toast toast--${toast.tone}`} role="status">
          <span className="toast-mark" />
          <p>{toast.text}</p>
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      {modal === "new" && (
        <NewDebateModal
          settings={settings}
          onCreate={handleCreate}
          onClose={() => setModal(null)}
          onOpenSettings={() => setModal("settings")}
        />
      )}
      {modal === "import" && (
        <ImportModal
          onImport={handleImport}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "export" && debate && (
        <ExportModal debate={debate} onClose={() => setModal(null)} />
      )}
      {modal === "settings" && settings && (
        <SettingsModal
          settings={settings}
          onSaved={(next) => { setSettings(next); showToast("Settings saved."); }}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "judge" && debate && (
        <JudgmentModal
          debate={debate}
          settings={settings}
          onRun={conveneJudgment}
          onClose={() => setModal(null)}
          onOpenSettings={() => setModal("settings")}
        />
      )}
      {deleteTarget && (
        <ConfirmModal
          title="Remove this debate?"
          message={`“${deleteTarget.motion}” and its map will be deleted from this machine.`}
          confirmLabel="Remove debate"
          onConfirm={handleDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
