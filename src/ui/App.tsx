import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Debate, DebateSummary } from "../core/model";
import { message } from "../core/model";
import { randomSeed, stageDebate, type StagedDebate } from "../core/stage";
import {
  buildJudgmentRecord,
  judgmentMarkdown,
  linksAtStep,
  motionOutcomeForDisplay,
  OUTCOME_SHORT,
  solveJudgment,
  type JudgmentRecordEntry,
  type JudgmentRun,
  type JudgmentSnapshot,
  type SavedJudgmentSummary
} from "../core/judgment";
import {
  addEdge,
  addResponse,
  changeEdgeType,
  removeEdge,
  removeNode,
  updateMotion,
  updateNode,
  type MotionEditPatch,
  type NodeEditPatch
} from "../core/edit";
import {
  createDebate,
  deleteDebate,
  deleteSavedJudgment,
  fetchDebate,
  fetchDebates,
  fetchSavedJudgment,
  fetchSavedJudgments,
  fetchSettings,
  importArgdown,
  judgeDebateStream,
  saveDebate,
  saveJudgmentRun,
  sendChat,
  type JudgeStreamOptions,
  type UiSettings
} from "./api";
import { DebateGraph } from "./components/DebateGraph";
import type { GraphHandle, GraphJudgment, GraphStage } from "./components/DebateGraph";
import { ChatPanel } from "./components/ChatPanel";
import { StagePanel } from "./components/StagePanel";
import { NodeInspector } from "./components/NodeInspector";
import { MapEditor } from "./components/MapEditor";
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
  /** Number of unified record entries entered. 0 is the bench intro. */
  eventIndex: number;
  /** The final judgment has replaced the last record entry. */
  finished: boolean;
  /** The final judgment has been reached once; its record row stays available. */
  finalSeen: boolean;
  playing: boolean;
  speed: number;
  /** A saved run is read-only and uses its frozen graph. */
  saved?: {
    id: string;
    savedAt: number;
    stale: boolean;
    frozenDebate: Debate;
    snapshot: JudgmentSnapshot;
  };
}

/** One visible beat of the judgment playback: every ruling and every stem cue. */
const PLAYBACK_BEAT_MS = 3600;
/** Give the speech engine a moment to start before falling back to the clock. */
const SPEECH_START_GRACE_MS = 4000;
/** A short visual pause after the utterance ends, before the next turn. */
const SPEECH_GAP_MS = 450;

/**
 * Generous upper bound for a spoken turn. `onend` is the normal trigger; this
 * only keeps the stage moving if a browser engine reports neither start nor
 * end. Speech rate is clamped, so a very short utterance still gets a beat.
 */
function speechSafetyDelay(text: string, rate: number): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const safeRate = Math.max(0.5, Math.min(2, rate));
  return Math.min(90_000, Math.max(6_000, 2_500 + (words * 460) / safeRate));
}

const ACTIVE_KEY = "agora.active";

/** The draft is isolated from the saved map, including nested node arrays. */
function copyDebate(debate: Debate): Debate {
  return structuredClone(debate);
}

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

function effectRevealKey(runId: string, step: number): string {
  return `${runId}:${step}`;
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
  const [savedJudgments, setSavedJudgments] = useState<SavedJudgmentSummary[]>([]);
  const [savedHistoryLoading, setSavedHistoryLoading] = useState(false);
  const [savingJudgment, setSavingJudgment] = useState(false);
  const [restored, setRestored] = useState<string[]>([]);
  const [revealedEffects, setRevealedEffects] = useState<string[]>([]);
  const [focusMap, setFocusMap] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState<Debate | null>(null);
  const [editHistory, setEditHistory] = useState<Debate[]>([]);
  const [editFuture, setEditFuture] = useState<Debate[]>([]);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const graphRef = useRef<GraphHandle | null>(null);
  const toastTimer = useRef<number | null>(null);
  const fieldCheckpoint = useRef(false);

  const showToast = useCallback((text: string, tone: "ok" | "warn" | "error" = "ok") => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ text, tone });
    toastTimer.current = window.setTimeout(() => setToast(null), 5200);
  }, []);

  const refreshSummaries = useCallback(async () => {
    try {
      const response = await fetchDebates();
      setSummaries(response.debates);
      if (response.warnings?.length) showToast(response.warnings[0]!, "warn");
    } catch {
      /* summaries are cosmetic; the active debate still works */
    }
  }, [showToast]);

  const loadSavedHistory = useCallback(async (debateId: string) => {
    setSavedHistoryLoading(true);
    try {
      const response = await fetchSavedJudgments(debateId);
      setSavedJudgments(response.judgments);
    } catch (error) {
      setSavedJudgments([]);
      showToast(error instanceof Error ? error.message : "Could not read the saved judgments.", "error");
    } finally {
      setSavedHistoryLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (modal !== "judge" || !debate) return;
    void loadSavedHistory(debate.id);
  }, [modal, debate?.id, loadSavedHistory]);

  useEffect(() => {
    if (!debate) setSavedJudgments([]);
  }, [debate?.id]);

  const loadDebate = useCallback(async (id: string) => {
    setLoadingDebate(true);
    try {
      const response = await fetchDebate(id);
      setDebate(response.debate);
      setActiveId(id);
      setSelectedId(null);
      setStage(null);
      setJudgment(null);
      setSavedJudgments([]);
      setRestored([]);
      setEditing(false);
      setEditDraft(null);
      setEditHistory([]);
      setEditFuture([]);
      setEditError(null);
      fieldCheckpoint.current = false;
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
        if (debateResponse.warnings?.length) showToast(debateResponse.warnings[0]!, "warn");
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

  const displayedDebate = editing ? editDraft : judgment?.saved?.frozenDebate ?? debate;

  const selectedNode = useMemo(
    () => (displayedDebate && selectedId
      ? displayedDebate.nodes.find((node) => node.id === selectedId) ?? null
      : null),
    [displayedDebate, selectedId]
  );

  const judgmentRecord = useMemo(
    () => (judgment ? buildJudgmentRecord(judgment.run) : []),
    [judgment?.run, debate]
  );

  const currentEntry: JudgmentRecordEntry | undefined =
    judgment && judgment.eventIndex > 0 ? judgmentRecord[judgment.eventIndex - 1] : undefined;

  // The conflict prefix is a property of the current record entry, not a
  // separately mutable playback counter. Supports contribute zero conflicts;
  // a ruling contributes its own position in the conflict sequence.
  const conflictStep = judgment?.finished
    ? judgment.run.verdicts.length
    : currentEntry
      ? currentEntry.kind === "ruling"
        ? currentEntry.index
        : currentEntry.step
      : 0;

  const currentSupportId =
    !judgment?.finished && currentEntry?.kind === "support" ? currentEntry.support.edgeId : undefined;

  const appliedVerdicts = useMemo(
    () => (judgment ? judgment.run.verdicts.slice(0, conflictStep) : []),
    [judgment?.run, conflictStep]
  );

  const appliedLinks = useMemo(
    () => (judgment ? linksAtStep(judgment.run, conflictStep) : []),
    [judgment?.run, conflictStep]
  );

  const judgmentSnapshot = useMemo(
    () =>
      judgment?.saved && judgment.finished
        ? judgment.saved.snapshot
        : displayedDebate && judgment
          ? solveJudgment(
              displayedDebate,
              appliedLinks,
              judgment.run.clusters,
              judgment.run.standard,
              judgment.run.strictness,
              judgment.run.engine === "llm"
            )
          : null,
    [displayedDebate, judgment, appliedLinks]
  );

  const priorJudgmentSnapshot = useMemo(
    () => {
      if (!displayedDebate || !judgment || conflictStep <= 0) return null;
      return solveJudgment(
        displayedDebate,
        linksAtStep(judgment.run, conflictStep - 1),
        judgment.run.clusters,
        judgment.run.standard,
        judgment.run.strictness,
        judgment.run.engine === "llm"
      );
    },
    [displayedDebate, judgment?.run, conflictStep]
  );

  const judgmentComplete = Boolean(judgment?.finished);

  const effectRevealed = Boolean(
    judgment &&
      (judgment.finished ||
        (conflictStep > 0 && revealedEffects.includes(effectRevealKey(judgment.run.id, conflictStep))))
  );

  const visibleCounts = judgment && effectRevealed && judgmentSnapshot
    ? judgmentSnapshot.counts
    : judgment && conflictStep > 1 && priorJudgmentSnapshot
      ? priorJudgmentSnapshot.counts
      : { standing: displayedDebate?.nodes.length ?? 0, defeated: 0, contested: 0 };

  const restoredNow = useMemo(() => {
    if (!judgment || !priorJudgmentSnapshot || !judgmentSnapshot) return [] as string[];
    return Object.keys(judgmentSnapshot.statuses).filter(
      (id) => priorJudgmentSnapshot.statuses[id] === "defeated" && judgmentSnapshot.statuses[id] !== "defeated"
    );
  }, [judgment, priorJudgmentSnapshot, judgmentSnapshot]);

  useEffect(() => {
    setRestored(restoredNow);
  }, [restoredNow.join("|"), conflictStep]);

  const judgmentGraph: GraphJudgment | undefined = useMemo(() => {
    if (!judgment || !displayedDebate || !judgmentSnapshot) return undefined;
    const current = !judgment.finished && currentEntry?.kind === "ruling" ? currentEntry.verdict : undefined;
    const verdictByEdge: GraphJudgment["verdictByEdge"] = {};
    const visibleVerdicts = effectRevealed ? appliedVerdicts : appliedVerdicts.slice(0, -1);
    for (const verdict of visibleVerdicts) verdictByEdge[verdict.edgeId] = verdict.verdict;
    const settled = judgmentComplete;
    const motionSnapshot = effectRevealed
      ? judgmentSnapshot
      : priorJudgmentSnapshot ?? judgmentSnapshot;
    const motion = motionOutcomeForDisplay({
      standard: judgment.run.standard,
      complete: settled && effectRevealed,
      outcome: motionSnapshot.outcome,
      thesisStatus: motionSnapshot.thesisStatus,
      proofConflict: motionSnapshot.proofConflict
    });
    const caseLine = currentSupportId
      ? displayedDebate.edges.find((edge) => edge.id === currentSupportId)
      : undefined;
    const visibleStatuses = effectRevealed
      ? judgmentSnapshot.statuses
      : conflictStep > 1 && priorJudgmentSnapshot
        ? priorJudgmentSnapshot.statuses
        : {};
    const visibleWeakened = effectRevealed
      ? judgmentSnapshot.weakened
      : conflictStep > 1 && priorJudgmentSnapshot
        ? priorJudgmentSnapshot.weakened
        : [];
    const visibleIrrelevant = effectRevealed
      ? judgmentSnapshot.irrelevant
      : conflictStep > 1 && priorJudgmentSnapshot
        ? priorJudgmentSnapshot.irrelevant
        : [];
    return {
      active: true,
      statuses: visibleStatuses,
      weakened: visibleWeakened,
      irrelevant: visibleIrrelevant,
      activeEdgeId: settled || caseLine ? undefined : current?.edgeId,
      activeNodeIds: settled || caseLine || !current ? [] : [current.from, current.to],
      caseLineEdgeId: caseLine?.id,
      caseLineNodeId: caseLine?.from,
      reinstated: effectRevealed ? restored : [],
      verdictByEdge,
      complete: settled,
      outcome: settled && effectRevealed ? judgmentSnapshot.outcome : undefined,
      motionDisposition: motion.outcome,
      motionProvisional: motion.provisional,
      motionProved: settled && effectRevealed && judgmentSnapshot.proofs.length > 0 && !judgmentSnapshot.proofConflict,
      unsupportedThesis: settled && effectRevealed && judgmentSnapshot.unsupportedThesis
    };
  }, [judgment, judgmentSnapshot, priorJudgmentSnapshot, revealedEffects, effectRevealed, judgmentComplete, appliedVerdicts, restored, currentEntry, currentSupportId, conflictStep, displayedDebate]);

  const openStage = useCallback(() => {
    if (!debate || editing) return;
    const transcript = stageDebate(debate, randomSeed());
    setJudgment(null);
    setRestored([]);
    setSelectedId(null);
    setStage({ transcript, index: 0, playing: true, speed: 1, voice: false });
  }, [debate, editing]);

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
    if (!debate || editing) return;
    if (stage) closeStage();
    setFocusMap(false);
    setSelectedId(null);
    setModal("judge");
  }, [debate, editing, stage, closeStage]);

  const conveneJudgment = useCallback(async (input: JudgeRunInput, options: JudgeStreamOptions = {}) => {
    if (!debate) throw new Error("Open a debate before convening the bench.");
    const response = await judgeDebateStream(debate.id, input, options);
    if (options.signal?.aborted) return;
    setRestored([]);
    setRevealedEffects([]);
    setStage(null);
    setSelectedId(null);
    setJudgment({ run: response.run, eventIndex: 0, finished: false, finalSeen: false, playing: true, speed: 1 });
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
    setRevealedEffects([]);
    setSelectedId(null);
  }, []);

  const openSavedJudgment = useCallback(async (runId: string) => {
    if (!debate) return;
    try {
      const response = await fetchSavedJudgment(debate.id, runId);
      if (response.stale) {
        showToast("Saved judgment opened from an earlier version of this map.", "warn");
      } else {
        showToast("Saved judgment opened.");
      }
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
      setRestored([]);
      setRevealedEffects([]);
      setStage(null);
      setSelectedId(null);
      setJudgment({
        run: response.judgment.run,
        eventIndex: buildJudgmentRecord(response.judgment.run).length,
        finished: true,
        finalSeen: true,
        playing: false,
        speed: 1,
        saved: {
          id: response.judgment.id,
          savedAt: response.judgment.savedAt,
          stale: response.stale,
          frozenDebate: response.judgment.frozenDebate,
          snapshot: response.judgment.snapshot
        }
      });
      setModal(null);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not open that saved judgment.", "error");
    }
  }, [debate, showToast]);

  const saveCurrentJudgment = useCallback(async () => {
    if (!debate || !judgment || judgment.saved || savingJudgment) return;
    setSavingJudgment(true);
    try {
      const response = await saveJudgmentRun(debate.id, judgment.run);
      setJudgment((current) => current
        ? {
            ...current,
            saved: {
              id: response.judgment.id,
              savedAt: response.judgment.savedAt,
              stale: response.stale,
              frozenDebate: response.judgment.frozenDebate,
              snapshot: response.judgment.snapshot
            }
          }
        : current);
      showToast("Judgment saved to this debate.");
      await loadSavedHistory(debate.id);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not save this judgment.", "error");
    } finally {
      setSavingJudgment(false);
    }
  }, [debate, judgment, savingJudgment, showToast, loadSavedHistory]);

  const removeSavedJudgment = useCallback(async (runId: string) => {
    if (!debate) return;
    if (!window.confirm("Delete this saved judgment from the bench history?")) return;
    try {
      await deleteSavedJudgment(debate.id, runId);
      setSavedJudgments((current) => current.filter((entry) => entry.id !== runId));
      showToast("Saved judgment deleted.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not delete that saved judgment.", "error");
    }
  }, [debate, showToast]);

  const rememberDraft = useCallback(() => {
    if (!editDraft) return;
    setEditHistory((history) => [...history, copyDebate(editDraft)].slice(-40));
    setEditFuture([]);
  }, [editDraft]);

  const checkpointField = useCallback(() => {
    if (!fieldCheckpoint.current) return;
    fieldCheckpoint.current = false;
    rememberDraft();
  }, [rememberDraft]);

  const beginEditing = useCallback(() => {
    if (!debate || chatBusy || stage || judgment) return;
    setFocusMap(false);
    setEditDraft(copyDebate(debate));
    setEditHistory([]);
    setEditFuture([]);
    setEditError(null);
    setEditBusy(false);
    setSelectedId(debate.thesisId);
    fieldCheckpoint.current = false;
    setEditing(true);
  }, [debate, chatBusy, stage, judgment]);

  const markFieldFocus = useCallback(() => {
    fieldCheckpoint.current = true;
  }, []);

  const changeDraftNode = useCallback((id: string, patch: NodeEditPatch) => {
    if (!editDraft) return;
    const next = updateNode(editDraft, id, patch);
    if (next === editDraft) return;
    checkpointField();
    setEditError(null);
    setEditDraft(next);
  }, [editDraft, checkpointField]);

  const changeDraftMotion = useCallback((patch: MotionEditPatch) => {
    if (!editDraft) return;
    const next = updateMotion(editDraft, patch);
    if (next === editDraft) return;
    checkpointField();
    setEditError(null);
    setEditDraft(next);
  }, [editDraft, checkpointField]);

  const addDraftResponse = useCallback((targetId: string, type: "support" | "attack" | "undercut", title: string) => {
    if (!editDraft) return;
    try {
      const result = addResponse(editDraft, targetId, type, title);
      rememberDraft();
      setEditError(null);
      setEditDraft(result.debate);
      setSelectedId(result.nodeId);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Could not add that response.");
    }
  }, [editDraft, rememberDraft]);

  const addDraftEdge = useCallback((from: string, to: string, type: "support" | "attack" | "undercut") => {
    if (!editDraft) return false;
    const result = addEdge(editDraft, from, to, type);
    if (!result.ok) {
      setEditError(result.error ?? "Could not add that relation.");
      return false;
    }
    rememberDraft();
    setEditError(null);
    setEditDraft(result.debate);
    return true;
  }, [editDraft, rememberDraft]);

  const changeDraftEdgeType = useCallback((edgeId: string, type: "support" | "attack" | "undercut") => {
    if (!editDraft) return;
    const next = changeEdgeType(editDraft, edgeId, type);
    if (next === editDraft) return;
    rememberDraft();
    setEditError(null);
    setEditDraft(next);
  }, [editDraft, rememberDraft]);

  const removeDraftEdge = useCallback((edgeId: string) => {
    if (!editDraft) return;
    const result = removeEdge(editDraft, edgeId);
    if (!result.ok) {
      setEditError(result.error ?? "Could not remove that relation.");
      return;
    }
    rememberDraft();
    setEditError(null);
    setEditDraft(result.debate);
  }, [editDraft, rememberDraft]);

  const removeDraftNode = useCallback((nodeId: string) => {
    if (!editDraft) return;
    const result = removeNode(editDraft, nodeId);
    if (!result.ok) {
      setEditError(result.error ?? "Could not remove that argument.");
      return;
    }
    rememberDraft();
    setEditError(null);
    setEditDraft(result.debate);
    if (selectedId === nodeId) setSelectedId(editDraft.thesisId);
  }, [editDraft, rememberDraft, selectedId]);

  const undoDraft = useCallback(() => {
    if (!editDraft || editHistory.length === 0) return;
    const previous = editHistory[editHistory.length - 1]!;
    setEditFuture((future) => [copyDebate(editDraft), ...future].slice(0, 40));
    setEditHistory((history) => history.slice(0, -1));
    setEditDraft(copyDebate(previous));
    if (!previous.nodes.some((node) => node.id === selectedId)) setSelectedId(previous.thesisId);
    setEditError(null);
    fieldCheckpoint.current = false;
  }, [editDraft, editHistory, selectedId]);

  const redoDraft = useCallback(() => {
    if (!editDraft || editFuture.length === 0) return;
    const next = editFuture[0]!;
    setEditHistory((history) => [...history, copyDebate(editDraft)].slice(-40));
    setEditFuture((future) => future.slice(1));
    setEditDraft(copyDebate(next));
    if (!next.nodes.some((node) => node.id === selectedId)) setSelectedId(next.thesisId);
    setEditError(null);
    fieldCheckpoint.current = false;
  }, [editDraft, editFuture, selectedId]);

  const cancelEditing = useCallback(() => {
    if (editBusy) return;
    setEditing(false);
    setEditDraft(null);
    setEditHistory([]);
    setEditFuture([]);
    setEditError(null);
    setSelectedId(null);
    fieldCheckpoint.current = false;
  }, [editBusy]);

  const finishEditing = useCallback(async () => {
    if (!debate || !editDraft || editBusy) return;
    setEditBusy(true);
    setEditError(null);
    try {
      const result = await saveDebate(debate.id, editDraft);
      setDebate(result.debate);
      setEditing(false);
      setEditDraft(null);
      setEditHistory([]);
      setEditFuture([]);
      setSelectedId(null);
      fieldCheckpoint.current = false;
      await refreshSummaries();
      showToast("Map saved.");
    } catch (error) {
      const text = error instanceof Error ? error.message : "Could not save the map.";
      setEditError(text);
      showToast(text, "error");
    } finally {
      setEditBusy(false);
    }
  }, [debate, editDraft, editBusy, refreshSummaries, showToast]);

  useEffect(() => {
    if (!editing || modal) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redoDraft();
        else undoDraft();
      } else if (modifier && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redoDraft();
      } else if (event.key === "Delete" && selectedId && selectedId !== editDraft?.thesisId) {
        const control = target?.closest("button, a, input, textarea, select, [contenteditable='true']");
        if (control && !control.closest(".graph-node")) return;
        event.preventDefault();
        removeDraftNode(selectedId);
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancelEditing();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, modal, selectedId, editDraft?.thesisId, undoDraft, redoDraft, removeDraftNode, cancelEditing]);

  useEffect(() => {
    if (!editing) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [editing]);

  const toggleJudgmentPlay = useCallback(() => {
    if (judgment?.finished) {
      setRevealedEffects([]);
      setJudgment((current) => current
        ? { ...current, eventIndex: 0, finished: false, finalSeen: false, playing: true }
        : current);
      return;
    }
    setJudgment((current) => current ? { ...current, playing: !current.playing } : current);
  }, [judgment?.finished]);

  const nextEntry = useCallback(() => {
    setJudgment((current) => {
      if (!current) return current;
      const record = buildJudgmentRecord(current.run);
      if (current.finished) return { ...current, playing: false };
      if (current.eventIndex < record.length) {
        return { ...current, eventIndex: current.eventIndex + 1, playing: false };
      }
      return { ...current, finished: true, finalSeen: true, playing: false };
    });
  }, []);

  const previousEntry = useCallback(() => {
    setRevealedEffects([]);
    setJudgment((current) => {
      if (!current) return current;
      const record = buildJudgmentRecord(current.run);
      if (current.finished) {
        return { ...current, eventIndex: record.length, finished: false, playing: false };
      }
      if (current.eventIndex <= 1) return { ...current, playing: false };
      return { ...current, eventIndex: Math.max(0, current.eventIndex - 1), finished: false, playing: false };
    });
  }, []);

  const restartJudgment = useCallback(() => {
    setRevealedEffects([]);
    setJudgment((current) => current
      ? { ...current, eventIndex: 0, finished: false, finalSeen: false, playing: true }
      : current);
  }, []);

  const selectEntry = useCallback((order: number) => {
    setRevealedEffects([]);
    setJudgment((current) => {
      if (!current) return current;
      const record = buildJudgmentRecord(current.run);
      const target = Math.max(1, Math.min(record.length, order));
      return {
        ...current,
        eventIndex: target,
        finished: false,
        playing: false
      };
    });
  }, []);

  const showFinalJudgment = useCallback(() => {
    setJudgment((current) => {
      if (!current) return current;
      const record = buildJudgmentRecord(current.run);
      return {
        ...current,
        eventIndex: record.length,
        finished: true,
        finalSeen: true,
        playing: false
      };
    });
  }, []);

  const saveJudgmentReport = useCallback(() => {
    if (!displayedDebate || !judgment) return;
    const markdown = judgmentMarkdown(displayedDebate, judgment.run);
    const slug = displayedDebate.motion.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 54) || "debate";
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
  }, [displayedDebate, judgment, showToast]);

  useEffect(() => {
    if (!judgment?.playing || judgment.finished) return;
    const recordLength = judgmentRecord.length;
    if (judgment.eventIndex >= recordLength) {
      // The last record entry gets its own beat, then the final judgment
      // replaces it as a separate end state.
      const timer = window.setTimeout(() => {
        setJudgment((current) => current && current.playing && !current.finished
          ? { ...current, finished: true, finalSeen: true, playing: false }
          : current);
      }, PLAYBACK_BEAT_MS / judgment.speed);
      return () => window.clearTimeout(timer);
    }
    const from = judgment.eventIndex;
    const timer = window.setTimeout(() => {
      setJudgment((current) => {
        if (!current || !current.playing || current.finished || current.eventIndex !== from) return current;
        return { ...current, eventIndex: Math.min(recordLength, current.eventIndex + 1) };
      });
    }, PLAYBACK_BEAT_MS / judgment.speed);
    return () => window.clearTimeout(timer);
  }, [judgment?.playing, judgment?.eventIndex, judgment?.speed, judgment?.finished, judgmentRecord.length]);

  useEffect(() => {
    if (!judgment || judgment.finished || judgment.eventIndex <= 0) return;
    const entry = judgmentRecord[judgment.eventIndex - 1];
    if (!entry) return;
    if (entry.kind === "support") {
      // Selecting a support jumps to a conflict prefix. That prefix must be
      // visible immediately; the support itself is the selected station.
      if (entry.step > 0) {
        const key = effectRevealKey(judgment.run.id, entry.step);
        setRevealedEffects((current) => current.includes(key) ? current : [...current, key]);
      }
      return;
    }
    const key = effectRevealKey(judgment.run.id, entry.index);
    if (revealedEffects.includes(key)) return;
    if (!judgment.playing) {
      setRevealedEffects((current) => current.includes(key) ? current : [...current, key]);
      return;
    }
    const timer = window.setTimeout(() => {
      setRevealedEffects((current) => current.includes(key) ? current : [...current, key]);
    }, Math.max(0, PLAYBACK_BEAT_MS / judgment.speed - 350));
    return () => window.clearTimeout(timer);
  }, [judgment?.run.id, judgment?.eventIndex, judgment?.speed, judgment?.playing, judgment?.finished, revealedEffects, judgmentRecord]);

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
        nextEntry();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        previousEntry();
      } else if (event.key === "Escape" && !selectedId) {
        closeJudgment();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [judgment, selectedId, modal, toggleJudgmentPlay, nextEntry, previousEntry, closeJudgment]);

  useEffect(() => {
    if (!stage?.playing) return;
    const speechSupported = typeof window !== "undefined" && "speechSynthesis" in window;
    // With voice on, the utterance's end event owns the beat. The timer is
    // only the fallback for browsers that cannot speak at all.
    if (stage.voice && speechSupported) return;
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
  }, [stage?.playing, stage?.index, stage?.speed, stage?.transcript, stage?.voice]);

  useEffect(() => {
    if (!stage || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    if (!stage.voice || !stage.playing) return;
    const turn = stage.transcript.turns[stage.index];
    if (!turn) return;

    let cancelled = false;
    let advanced = false;
    let fallbackTimer: number | null = null;
    let gapTimer: number | null = null;

    const clearTimers = () => {
      if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
      if (gapTimer !== null) window.clearTimeout(gapTimer);
      fallbackTimer = null;
      gapTimer = null;
    };

    const advance = () => {
      if (cancelled || advanced) return;
      advanced = true;
      clearTimers();
      // Let the final syllable land before the next turn changes the card.
      gapTimer = window.setTimeout(() => {
        if (cancelled) return;
        setStage((current) => {
          if (!current || !current.playing) return current;
          if (current.index >= current.transcript.turns.length - 1) return { ...current, playing: false };
          return { ...current, index: current.index + 1 };
        });
      }, SPEECH_GAP_MS);
    };

    const scheduleFallback = (delay: number) => {
      if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
      fallbackTimer = window.setTimeout(advance, delay);
    };

    const utterance = new SpeechSynthesisUtterance(turn.text);
    utterance.rate = Math.min(1.7, 0.96 * stage.speed);
    utterance.pitch = turn.speaker === "challenger" ? 0.94 : turn.speaker === "advocate" ? 1.04 : 1;
    const voices = synth.getVoices().filter((voice) => voice.lang.toLowerCase().startsWith("en"));
    if (voices.length) {
      utterance.voice = turn.speaker === "challenger" ? voices[Math.min(1, voices.length - 1)]! : voices[0]!;
    }
    utterance.onstart = () => {
      if (cancelled) return;
      scheduleFallback(speechSafetyDelay(turn.text, utterance.rate));
    };
    utterance.onend = advance;
    utterance.onerror = advance;

    // If the engine never starts, do not strand the stage on one turn.
    scheduleFallback(SPEECH_START_GRACE_MS);
    try {
      synth.speak(utterance);
    } catch {
      advance();
    }

    return () => {
      cancelled = true;
      clearTimers();
      utterance.onstart = null;
      utterance.onend = null;
      utterance.onerror = null;
      synth.cancel();
    };
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

  const handleCreate = useCallback(async (text: string, signal?: AbortSignal) => {
    const result = await createDebate(text, signal);
    if (signal?.aborted) return;
    setDebate(result.debate);
    setActiveId(result.debate.id);
    setSelectedId(null);
    setJudgment(null);
    setRestored([]);
    setEditing(false);
    setEditDraft(null);
    setEditHistory([]);
    setEditFuture([]);
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
    setEditing(false);
    setEditDraft(null);
    setEditHistory([]);
    setEditFuture([]);
    localStorage.setItem(ACTIVE_KEY, result.debate.id);
    await refreshSummaries();
    showToast(result.warnings[0] ?? "Argdown imported.", result.warnings.length ? "warn" : "ok");
    return result.warnings;
  }, [refreshSummaries, showToast]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || !debate || chatBusy || editing) return;
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
  }, [draft, debate, chatBusy, editing, refreshSummaries, showToast]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget || editing) return;
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
  }, [deleteTarget, summaries, activeId, editing, loadDebate, showToast]);

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

  const shownDebate = displayedDebate ?? debate;
  const counts = shownDebate
    ? {
        pro: shownDebate.nodes.filter((node) => node.stance === "pro").length,
        con: shownDebate.nodes.filter((node) => node.stance === "con").length
      }
    : { pro: 0, con: 0 };

  return (
    <div className={`app ${stage ? "has-stage" : ""} ${focusMap ? "focus-map" : ""} ${judgment ? "is-judging" : ""} ${editing ? "is-editing" : ""}`}>
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
            {editing
              ? "The map is in your hands. Finish the draft when it holds."
              : judgment
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
            disabled={Boolean(judgment) || editing}
            title={editing ? "Finish or cancel the draft before changing the room" : judgment ? "Exit judgment to change the room" : focusMap ? "Show library and chamber" : "Give the map the whole room"}
          >
            {focusMap ? (
              <svg viewBox="0 0 18 18" width="15" height="15" aria-hidden="true"><path d="M7 2H2v5M11 16h5v-5M16 7V2h-5M2 11v5h5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            ) : (
              <svg viewBox="0 0 18 18" width="15" height="15" aria-hidden="true"><path d="M2 7V2h5M16 11v5h-5M16 7V2h-5M2 11v5h5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            )}
            {focusMap ? "Exit focus" : "Focus"}
          </button>
          <button type="button" className="btn btn--quiet" onClick={() => setModal("import")} disabled={Boolean(judgment) || editing} title={editing ? "Finish the draft before importing" : "Import Argdown"}>
            <svg viewBox="0 0 18 18" width="15" height="15" aria-hidden="true"><path d="M9 2v9M5.5 7.5 9 11l3.5-3.5M3 13.5V16h12v-2.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Import
          </button>
          <button type="button" className="btn btn--quiet" onClick={() => debate && setModal("export")} disabled={!debate || editing} title={editing ? "Finish the draft before exporting" : "Export Argdown"}>
            <svg viewBox="0 0 18 18" width="15" height="15" aria-hidden="true"><path d="M9 11V2M5.5 5.5 9 2l3.5 3.5M3 13.5V16h12v-2.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Export
          </button>
          <button
            type="button"
            className={`btn btn--judge ${judgment ? "is-active" : ""}`}
            onClick={openJudgmentSetup}
            disabled={!debate || Boolean(judgment) || editing}
            title={editing ? "Finish the draft before convening a judgment" : judgment ? "The bench is in session" : "Convene a judgment on this map"}
          >
            <svg viewBox="0 0 18 18" width="15" height="15" aria-hidden="true">
              <path d="M9 2v13M5 15h8M4 5h10M4 5 2 10h4L4 5zm10 0-2 5h4l-2-5z" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {judgment ? "Judging" : "Judge"}
          </button>
          <button type="button" className="btn btn--stage" onClick={openStage} disabled={!debate || Boolean(judgment) || editing} title={editing ? "Finish the draft before staging" : undefined}>
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
            <button type="button" className="library-new" onClick={() => setModal("new")} aria-label="New debate" title="New debate" disabled={editing}>+</button>
          </div>

          <div className="library-list">
            {summaries.map((item) => (
              <div key={item.id} className={`library-card ${item.id === activeId ? "is-active" : ""}`}>
                <button
                  type="button"
                  className="library-card-main"
                  onClick={() => item.id !== activeId && loadDebate(item.id)}
                  disabled={editing}
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
                  disabled={editing}
                >×</button>
              </div>
            ))}
            {summaries.length === 0 && (
              <div className="library-empty">
                <p>No motions on the floor.</p>
                <button type="button" className="text-link" onClick={() => setModal("new")} disabled={editing}>Convene the first debate</button>
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
            <div className="canvas-head-row">
              <div className="eyebrow">{judgment ? "Judgment · the bench" : editing ? "Argument map · editing draft" : "Argument map"}</div>
              {displayedDebate && (
                judgment && judgmentSnapshot ? (
                  <div className="canvas-stats canvas-stats--judgment">
                    {conflictStep > 0 || judgmentComplete ? (
                      <>
                        <span><b>{visibleCounts.standing}</b> standing</span>
                        <span><b>{visibleCounts.defeated}</b> defeated</span>
                        <span><b>{visibleCounts.contested}</b> contested</span>
                      </>
                    ) : (
                      <span>The bench is reading</span>
                    )}
                    <span className={`judgment-state-tag ${judgmentComplete && effectRevealed ? `judgment-state-tag--${judgmentSnapshot.outcome}` : ""}`}>
                      {judgmentComplete && effectRevealed ? OUTCOME_SHORT[judgmentSnapshot.outcome] : "In session"}
                    </span>
                  </div>
                ) : (
                  <div className="canvas-stats">
                    <span><b>{displayedDebate.nodes.length}</b> nodes</span>
                    <span><b>{displayedDebate.edges.length}</b> relations</span>
                    <span className="canvas-split"><i className="score-dot score-dot--pro" />{counts.pro} <i className="score-dot score-dot--con" />{counts.con}</span>
                    <span className={`origin-tag origin-tag--${displayedDebate.origin}`}>
                      {editing
                        ? "Draft"
                        : displayedDebate.origin === "imported" ? "Imported" : displayedDebate.origin === "seed" ? "Reference map" : "Authored"}
                    </span>
                  </div>
                )
              )}
            </div>
            <div className="canvas-heading">
              {displayedDebate ? (
                <h1 className="canvas-motion">{displayedDebate.motion}</h1>
              ) : (
                <h1 className="canvas-motion">No motion on the floor</h1>
              )}
              {displayedDebate && <p className="canvas-sub">{displayedDebate.thesisText}</p>}
            </div>
          </div>

          <div className="canvas-body">
            {displayedDebate ? (
              <>
                <DebateGraph
                  ref={graphRef}
                  debate={displayedDebate}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  stage={stageGraph}
                  judgment={judgmentGraph}
                  editing={editing}
                  canEdit={!chatBusy}
                  onBeginEdit={beginEditing}
                />
                {!editing && selectedNode && (
                  <NodeInspector
                    debate={displayedDebate}
                    node={selectedNode}
                    onClose={() => setSelectedId(null)}
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

        {editing && editDraft ? (
          <MapEditor
            debate={editDraft}
            selectedId={selectedId ?? editDraft.thesisId}
            busy={editBusy}
            error={editError}
            canUndo={editHistory.length > 0}
            canRedo={editFuture.length > 0}
            onChangeNode={changeDraftNode}
            onChangeMotion={changeDraftMotion}
            onAddResponse={addDraftResponse}
            onAddEdge={addDraftEdge}
            onChangeEdgeType={changeDraftEdgeType}
            onRemoveEdge={removeDraftEdge}
            onRemoveNode={removeDraftNode}
            onFieldFocus={markFieldFocus}
            onDone={() => void finishEditing()}
            onCancel={cancelEditing}
            onUndo={undoDraft}
            onRedo={redoDraft}
          />
        ) : judgment && displayedDebate && judgmentSnapshot ? (
          <JudgmentPanel
            debate={displayedDebate}
            run={judgment.run}
            step={conflictStep}
            currentOrder={judgment.eventIndex}
            finished={judgment.finished}
            finalSeen={judgment.finalSeen}
            playing={judgment.playing}
            speed={judgment.speed}
            snapshot={judgmentSnapshot}
            restored={effectRevealed ? restored : []}
            counts={visibleCounts}
            caseLineId={currentSupportId}
            onTogglePlay={toggleJudgmentPlay}
            onNext={nextEntry}
            onPrevious={previousEntry}
            onRestart={restartJudgment}
            onSeek={selectEntry}
            onShowFinal={showFinalJudgment}
            onSpeedChange={(speed) => setJudgment((current) => current ? { ...current, speed } : current)}
            onExit={closeJudgment}
            onNewRun={() => setModal("judge")}
            onOpenSettings={() => setModal("settings")}
            onReport={saveJudgmentReport}
            onSave={() => void saveCurrentJudgment()}
            saving={savingJudgment}
            savedAt={judgment.saved?.savedAt}
            stale={judgment.saved?.stale}
            onHistory={() => setModal("judge")}
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

      {stage && debate && !editing && (
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
          savedJudgments={savedJudgments}
          historyLoading={savedHistoryLoading}
          onOpenSaved={openSavedJudgment}
          onDeleteSaved={removeSavedJudgment}
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
