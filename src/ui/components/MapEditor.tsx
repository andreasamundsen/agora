import { useEffect, useMemo, useRef, useState } from "react";
import type { Debate, DebateEdge, DebateNode, RelationType } from "../../core/model";
import { SPEAKER_LABEL, nodeById } from "../../core/model";
import { stanceForResponse, type MotionEditPatch, type NodeEditPatch } from "../../core/edit";

interface Props {
  debate: Debate;
  selectedId: string;
  busy: boolean;
  error?: string | null;
  canUndo: boolean;
  canRedo: boolean;
  onChangeNode: (id: string, patch: NodeEditPatch) => void;
  onChangeMotion: (patch: MotionEditPatch) => void;
  onAddResponse: (targetId: string, type: RelationType, title: string) => void;
  onAddEdge: (from: string, to: string, type: RelationType) => boolean;
  onChangeEdgeType: (edgeId: string, type: RelationType) => void;
  onRemoveEdge: (edgeId: string) => void;
  onRemoveNode: (id: string) => void;
  onFieldFocus: () => void;
  onDone: () => void;
  onCancel: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

/** Stance, speaker and motion tags are maintained from the graph itself. */
const DERIVED_TAGS = new Set([
  "pro",
  "con",
  "neutral",
  "advocate",
  "challenger",
  "moderator",
  "you",
  "user",
  "motion",
  "thesis"
]);

function editableTags(tags: string[] | undefined): string[] {
  return (tags ?? []).filter((tag) => !DERIVED_TAGS.has(tag.toLowerCase()));
}

function shortStance(stance: DebateNode["stance"]): string {
  return stance === "pro" ? "For the motion" : stance === "con" ? "Against the motion" : "Context";
}

function relationDirection(edge: DebateEdge, nodeId: string, thesisId: string): string {
  const outgoing = edge.from === nodeId;
  if (outgoing) return edge.to === thesisId ? "This argument → the motion" : "This argument →";
  return edge.from === thesisId ? "The motion → this argument" : "→ This argument";
}

export function MapEditor({
  debate,
  selectedId,
  busy,
  error,
  canUndo,
  canRedo,
  onChangeNode,
  onChangeMotion,
  onAddResponse,
  onAddEdge,
  onChangeEdgeType,
  onRemoveEdge,
  onRemoveNode,
  onFieldFocus,
  onDone,
  onCancel,
  onUndo,
  onRedo
}: Props) {
  const node = nodeById(debate, selectedId) ?? nodeById(debate, debate.thesisId);
  const isMotion = node?.id === debate.thesisId;
  const [responseOpen, setResponseOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [responseType, setResponseType] = useState<RelationType>("support");
  const [responseTitle, setResponseTitle] = useState("");
  const [linkTo, setLinkTo] = useState("");
  const [linkType, setLinkType] = useState<RelationType>("support");
  const [premisesText, setPremisesText] = useState("");
  const [tagsText, setTagsText] = useState("");
  const premisesRef = useRef<HTMLTextAreaElement | null>(null);
  const tagsRef = useRef<HTMLInputElement | null>(null);
  const fieldActive = useRef(false);

  const beginField = () => {
    if (fieldActive.current) return;
    fieldActive.current = true;
    onFieldFocus();
  };
  const endField = () => {
    fieldActive.current = false;
  };

  const relations = useMemo(
    () => debate.edges.filter((edge) => edge.from === node?.id || edge.to === node?.id),
    [debate.edges, node?.id]
  );
  const targets = useMemo(
    () => debate.nodes.filter((candidate) => candidate.id !== node?.id),
    [debate.nodes, node?.id]
  );

  useEffect(() => {
    fieldActive.current = false;
    setResponseOpen(false);
    setLinkOpen(false);
    setResponseType("support");
    setResponseTitle("");
    setLinkType("support");
    setLinkTo(targets[0]?.id ?? "");
    setPremisesText(node?.premises.join("\n") ?? "");
    setTagsText(editableTags(node?.tags).join(", "));
    // The form follows the selected card. Do not reset it on every draft edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.id]);

  useEffect(() => {
    if (document.activeElement !== premisesRef.current) {
      setPremisesText(node?.premises.join("\n") ?? "");
    }
  }, [node?.premises]);

  useEffect(() => {
    if (document.activeElement !== tagsRef.current) {
      setTagsText(editableTags(node?.tags).join(", "));
    }
  }, [node?.tags]);

  if (!node) {
    return (
      <aside className="map-editor" aria-label="Map editor">
        <div className="map-editor-empty">Select a card to edit it.</div>
      </aside>
    );
  }

  const responseStance = stanceForResponse(node, responseType);
  const previewStance = responseStance === "pro" ? "For the motion" : "Against the motion";
  const canAddResponse = Boolean(responseTitle.trim());

  const changeNode = (patch: NodeEditPatch) => {
    if (isMotion) {
      onChangeMotion({
        title: patch.title,
        text: patch.text,
        premises: patch.premises,
        conclusion: patch.conclusion,
        tags: patch.tags
      });
    } else {
      onChangeNode(node.id, patch);
    }
  };

  const commitPremises = () => {
    changeNode({ premises: premisesText.split("\n") });
  };

  const commitTags = () => {
    changeNode({ tags: tagsText.split(",") });
  };

  const createResponse = () => {
    if (!canAddResponse) return;
    onAddResponse(node.id, responseType, responseTitle.trim());
    setResponseOpen(false);
    setResponseTitle("");
    setResponseType("support");
  };

  const createLink = () => {
    if (!linkTo || linkTo === node.id) return;
    if (onAddEdge(node.id, linkTo, linkType)) {
      setLinkOpen(false);
    }
  };

  return (
    <aside className="map-editor" aria-label="Map editor">
      <header className="map-editor-head">
        <div>
          <div className="eyebrow">Map editor</div>
          <h2>Edit draft</h2>
        </div>
        <span className="map-editor-draft">Unsaved</span>
      </header>

      <div className="map-editor-toolbar" role="toolbar" aria-label="Draft controls">
        <button type="button" className="editor-tool" onClick={onUndo} disabled={!canUndo || busy}>Undo</button>
        <button type="button" className="editor-tool" onClick={onRedo} disabled={!canRedo || busy}>Redo</button>
        <span className="editor-tool-sep" />
        <button type="button" className="editor-tool editor-tool--cancel" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="editor-tool editor-tool--done" onClick={onDone} disabled={busy}>
          {busy ? "Saving…" : "Done"}
        </button>
      </div>

      <div className="map-editor-scroll">
        {error && <div className="map-editor-error" role="alert">{error}</div>}

        <div className="editor-selected">
          <div className="editor-selected-top">
            <span className="editor-kind">{isMotion ? "The motion" : node.kind === "argument" ? "Argument" : "Statement"}</span>
            <span className={`editor-stance editor-stance--${node.stance}`}>{shortStance(node.stance)}</span>
          </div>
          <p className="editor-selected-title">{node.title || "Untitled"}</p>
          <p className="editor-derived">
            {isMotion
              ? "The motion is the root claim. It can be edited, but not removed."
              : `Side and speaker follow the graph: ${SPEAKER_LABEL[node.speaker]}. Change a relation to change the side.`}
          </p>
        </div>

        <div className="editor-section">
          <div className="editor-label">Content</div>
          {!isMotion && (
            <label className="editor-field">
              <span>Kind</span>
              <select
                value={node.kind}
                onChange={(event) => {
                  beginField();
                  changeNode({ kind: event.target.value === "statement" ? "statement" : "argument" });
                }}
                onFocus={beginField}
                onBlur={endField}
                disabled={busy}
              >
                <option value="argument">Argument</option>
                <option value="statement">Statement</option>
              </select>
            </label>
          )}
          <label className="editor-field">
            <span>Title <i>{node.title.length}/{isMotion ? 160 : 96}</i></span>
            <input
              value={node.title}
              maxLength={isMotion ? 160 : 96}
              onChange={(event) => {
                beginField();
                changeNode({ title: event.target.value });
              }}
              onFocus={beginField}
              onBlur={endField}
              disabled={busy}
            />
          </label>
          <label className="editor-field">
            <span>Argument text <i>{node.text.length}/520</i></span>
            <textarea
              value={node.text}
              maxLength={520}
              rows={4}
              onChange={(event) => {
                beginField();
                changeNode({ text: event.target.value });
              }}
              onFocus={beginField}
              onBlur={endField}
              disabled={busy}
            />
          </label>
          <label className="editor-field">
            <span>Premises <i>one per line, max 5</i></span>
            <textarea
              ref={premisesRef}
              value={premisesText}
              rows={4}
              onChange={(event) => {
                beginField();
                setPremisesText(event.target.value);
                changeNode({ premises: event.target.value.split("\n") });
              }}
              onFocus={beginField}
              onBlur={() => { endField(); commitPremises(); }}
              disabled={busy}
            />
          </label>
          <label className="editor-field">
            <span>Conclusion</span>
            <textarea
              value={node.conclusion ?? ""}
              rows={2}
              maxLength={520}
              onChange={(event) => {
                beginField();
                changeNode({ conclusion: event.target.value });
              }}
              onFocus={beginField}
              onBlur={endField}
              disabled={busy}
            />
          </label>
          <label className="editor-field">
            <span>Tags <i>comma separated</i></span>
            <input
              ref={tagsRef}
              value={tagsText}
              onChange={(event) => {
                beginField();
                setTagsText(event.target.value);
                changeNode({ tags: event.target.value.split(",") });
              }}
              onFocus={beginField}
              onBlur={() => { endField(); commitTags(); }}
              disabled={busy}
            />
          </label>
        </div>

        <div className="editor-section">
          <div className="editor-label">Relations</div>
          <div className="editor-relations">
            {relations.length === 0 && <p className="editor-muted">No relations yet.</p>}
            {relations.map((edge) => {
              const other = nodeById(debate, edge.from === node.id ? edge.to : edge.from);
              return (
                <div className="editor-relation" key={edge.id}>
                  <div className="editor-relation-copy">
                    <b>{other?.title || "Unknown argument"}</b>
                    <span>{relationDirection(edge, node.id, debate.thesisId)}</span>
                  </div>
                  <select
                    value={edge.type}
                    aria-label={`Relation type for ${other?.title || "argument"}`}
                    onChange={(event) => onChangeEdgeType(edge.id, event.target.value as RelationType)}
                    disabled={busy}
                  >
                    <option value="support">Support</option>
                    <option value="attack">Attack</option>
                    <option value="undercut">Undercut</option>
                  </select>
                  <button
                    type="button"
                    className="editor-remove"
                    aria-label={`Remove relation to ${other?.title || "argument"}`}
                    title="Remove relation"
                    onClick={() => onRemoveEdge(edge.id)}
                    disabled={busy}
                  >×</button>
                </div>
              );
            })}
          </div>
          <div className="editor-actions">
            <button type="button" className={`editor-action ${responseOpen ? "is-open" : ""}`} onClick={() => setResponseOpen((value) => !value)} disabled={busy}>
              Add response
            </button>
            {!isMotion && (
              <button type="button" className={`editor-action ${linkOpen ? "is-open" : ""}`} onClick={() => setLinkOpen((value) => !value)} disabled={busy}>
                Link existing
              </button>
            )}
            {!isMotion && (
              <button type="button" className="editor-action editor-action--danger" onClick={() => onRemoveNode(node.id)} disabled={busy}>
                Remove argument
              </button>
            )}
          </div>

          {responseOpen && (
            <div className="editor-inline-form">
              <div className="editor-form-title">New response to {isMotion ? "the motion" : "this argument"}</div>
              <label className="editor-field">
                <span>Relation</span>
                <select value={responseType} onChange={(event) => setResponseType(event.target.value as RelationType)} disabled={busy}>
                  <option value="support">Support</option>
                  <option value="attack">Attack</option>
                  <option value="undercut">Undercut</option>
                </select>
              </label>
              <p className="editor-preview">This will sit on the <b>{previewStance}</b> side.</p>
              <label className="editor-field">
                <span>Working title</span>
                <input value={responseTitle} onChange={(event) => setResponseTitle(event.target.value)} placeholder="New argument" maxLength={96} disabled={busy} />
              </label>
              <div className="editor-actions">
                <button type="button" className="editor-action editor-action--primary" onClick={createResponse} disabled={!canAddResponse || busy}>Create argument</button>
                <button type="button" className="editor-action" onClick={() => setResponseOpen(false)} disabled={busy}>Cancel</button>
              </div>
            </div>
          )}

          {linkOpen && (
            <div className="editor-inline-form">
              <div className="editor-form-title">Link this argument to another</div>
              <p className="editor-preview">{isMotion ? "The motion" : "This argument"} will respond to the selected card.</p>
              <label className="editor-field">
                <span>Target</span>
                <select value={linkTo} onChange={(event) => setLinkTo(event.target.value)} disabled={busy}>
                  {targets.map((target) => (
                    <option key={target.id} value={target.id}>{target.title}</option>
                  ))}
                </select>
              </label>
              <label className="editor-field">
                <span>Relation</span>
                <select value={linkType} onChange={(event) => setLinkType(event.target.value as RelationType)} disabled={busy}>
                  <option value="support">Support</option>
                  <option value="attack">Attack</option>
                  <option value="undercut">Undercut</option>
                </select>
              </label>
              <div className="editor-actions">
                <button type="button" className="editor-action editor-action--primary" onClick={createLink} disabled={!linkTo || busy}>Add relation</button>
                <button type="button" className="editor-action" onClick={() => setLinkOpen(false)} disabled={busy}>Cancel</button>
              </div>
            </div>
          )}
        </div>

        <div className="editor-note">
          The draft is local until <b>Done</b>. Cancel restores the saved map; Undo and Redo stay inside this draft.
        </div>
      </div>
    </aside>
  );
}
