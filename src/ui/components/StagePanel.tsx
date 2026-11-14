import type { StagedDebate } from "../../core/stage";
import type { Speaker } from "../../core/model";

interface Props {
  transcript: StagedDebate;
  motion: string;
  index: number;
  playing: boolean;
  speed: number;
  voice: boolean;
  onTogglePlay: () => void;
  onNext: () => void;
  onRestart: () => void;
  onShuffle: () => void;
  onClose: () => void;
  onSpeedChange: (speed: number) => void;
  onToggleVoice: () => void;
}

const SPEAKER_NAME: Record<Speaker, string> = {
  advocate: "The Advocate",
  challenger: "The Challenger",
  moderator: "The Moderator",
  you: "You"
};

const KIND_LABEL: Record<string, string> = {
  opening: "The session opens",
  closing: "The session closes",
  support: "A reason for the motion",
  attack: "A reason against",
  undercut: "An undercut",
  statement: "A claim on the table"
};

export function StagePanel({
  transcript,
  motion,
  index,
  playing,
  speed,
  voice,
  onTogglePlay,
  onNext,
  onRestart,
  onShuffle,
  onClose,
  onSpeedChange,
  onToggleVoice
}: Props) {
  const turn = transcript.turns[index];
  const nextTurn = transcript.turns[index + 1];
  const total = transcript.turns.length;
  const progress = total > 0 ? ((index + 1) / total) * 100 : 0;
  const atEnd = index >= total - 1;
  const speechSupported = typeof window !== "undefined" && "speechSynthesis" in window;

  return (
    <section className={`stage-panel ${playing ? "is-playing" : ""}`} aria-label="Staged debate">
      <header className="stage-head">
        <div className="stage-brand">
          <span className="stage-live-dot" />
          <span>Staged debate</span>
        </div>
        <p className="stage-motion" title={motion}>
          {motion}
        </p>
        <div className="stage-controls">
          <button type="button" className="stage-icon-btn" onClick={onRestart} title="Restart" aria-label="Restart debate">
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M4 10a6 6 0 1 0 1.8-4.3M4 3v4h4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button type="button" className="stage-play-btn" onClick={onTogglePlay} aria-label={playing ? "Pause" : "Play"}>
            {playing ? (
              <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M6 4h3v12H6zM11 4h3v12h-3z" fill="currentColor"/></svg>
            ) : atEnd ? (
              <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M4 10a6 6 0 1 0 1.8-4.3M4 3v4h4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
            ) : (
              <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M6 3.5 16 10 6 16.5z" fill="currentColor"/></svg>
            )}
            <span>{playing ? "Pause" : atEnd ? "Replay" : "Play"}</span>
          </button>
          <button type="button" className="stage-icon-btn" onClick={onNext} disabled={atEnd} title="Next turn" aria-label="Next turn">
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M4 4l8 6-8 6zM14 4v12" fill="currentColor"/></svg>
          </button>
          <label className="stage-speed" title="Playback speed">
            <span className="sr-only">Playback speed</span>
            <select value={speed} onChange={(event) => onSpeedChange(Number(event.target.value))}>
              <option value={0.75}>0.75×</option>
              <option value={1}>1×</option>
              <option value={1.25}>1.25×</option>
              <option value={1.5}>1.5×</option>
              <option value={2}>2×</option>
            </select>
          </label>
          {speechSupported && (
            <button
              type="button"
              className={`stage-icon-btn stage-voice ${voice ? "is-on" : ""}`}
              onClick={onToggleVoice}
              title={voice ? "Turn voice off" : "Read turns aloud"}
              aria-pressed={voice}
              aria-label={voice ? "Turn voice off" : "Read turns aloud"}
            >
              <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M4 8v4h3l4 3V5L7 8zM14 7.2a4 4 0 0 1 0 5.6M15.8 5a7 7 0 0 1 0 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          )}
          <button type="button" className="stage-close-btn" onClick={onClose} title="Close stage" aria-label="Close stage">
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>
      </header>

      {turn && (
        <div className="stage-body">
          <div className="stage-left">
            <div className="stage-turn-no">
              Turn <b>{String(index + 1).padStart(2, "0")}</b> <span>/ {String(total).padStart(2, "0")}</span>
            </div>
            <div className={`stage-speaker speaker--${turn.speaker}`}>
              <span className="stage-speaker-dot" />
              {SPEAKER_NAME[turn.speaker]}
            </div>
            <div className="stage-heading">{turn.heading}</div>
            <div className="stage-progress">
              <i style={{ width: `${progress}%` }} />
            </div>
            <div className="stage-seed">
              seed {transcript.seed} <span>·</span> {transcript.stagedNodes}/{transcript.totalNodes} nodes staged
            </div>
          </div>

          <div className="stage-text-wrap" key={turn.id}>
            <div className="stage-kicker">{KIND_LABEL[turn.kind] ?? turn.kind}</div>
            <p className="stage-text">{turn.text}</p>
          </div>

          <div className="stage-right">
            <div className="stage-score">
              <span><i className="score-dot score-dot--pro" />For <b>{transcript.stats.pro}</b></span>
              <span><i className="score-dot score-dot--con" />Against <b>{transcript.stats.con}</b></span>
            </div>
            <div className="stage-next-label">{nextTurn ? "Next" : "End of sequence"}</div>
            <p className="stage-next">{nextTurn ? nextTurn.heading : "Close the stage or cut a new sequence."}</p>
            <button type="button" className="stage-shuffle" onClick={onShuffle}>
              <span aria-hidden="true">↺</span> Cut a new sequence
            </button>
          </div>
        </div>
      )}

      <div className="stage-progress-bar" aria-hidden="true">
        <i style={{ width: `${progress}%` }} />
      </div>
    </section>
  );
}
