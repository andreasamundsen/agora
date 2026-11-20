import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { reconcileDebate } from "../../core/model";
import {
  buildJudgmentRun,
  solveJudgment,
  type ClashJudgment,
  type SupportAssessment
} from "../../core/judgment";
import { JudgmentPanel } from "./JudgmentPanel";

function panelFixture() {
  const debate = reconcileDebate({
    id: "panel-case-line",
    motion: "Should the test pass?",
    thesisId: "thesis",
    nodes: [
      { id: "thesis", kind: "statement", title: "The test passes", text: "The test passes." },
      {
        id: "support",
        kind: "argument",
        title: "Supporting reason",
        text: "The support carries the thesis.",
        stance: "pro"
      },
      {
        id: "objection",
        kind: "argument",
        title: "An objection",
        text: "The objection weakens the thesis.",
        stance: "con"
      },
      {
        id: "objection2",
        kind: "argument",
        title: "Another objection",
        text: "A second objection also weakens the thesis.",
        stance: "con"
      }
    ],
    edges: [
      { id: "e_support", from: "support", to: "thesis", type: "support" },
      { id: "e_objection", from: "objection", to: "thesis", type: "attack" },
      { id: "e_objection2", from: "objection2", to: "thesis", type: "attack" }
    ]
  });
  const verdict: ClashJudgment = {
    edgeId: "e_objection",
    from: "objection",
    to: "thesis",
    type: "attack",
    verdict: "weakens",
    impact: "material",
    criterion: "sufficiency",
    confidence: "high",
    targetComponent: "conclusion",
    reasoning: "The objection has force but does not strike the thesis."
  };
  const verdict2: ClashJudgment = {
    ...verdict,
    edgeId: "e_objection2",
    from: "objection2",
    reasoning: "The second objection also has force but does not strike the thesis."
  };
  const supportAssessment: SupportAssessment = {
    edgeId: "e_support",
    from: "support",
    to: "thesis",
    type: "support",
    quality: "strong",
    confidence: "high",
    reasoning: "The support directly carries the thesis."
  };
  const links = [supportAssessment, verdict, verdict2];
  return {
    debate,
    run: buildJudgmentRun({
      id: "run-case-line-panel",
      debate,
      engine: "llm",
      judge: { provider: "test", model: "test" },
      standard: "preponderance",
      strictness: "balanced",
      links
    }),
    snapshot: solveJudgment(debate, links, [], "preponderance", "balanced")
  };
}

describe("JudgmentPanel case-line cue", () => {
  it("shows the opening support instead of the numbered ruling while a case line is active", () => {
    const { debate, run, snapshot } = panelFixture();
    const markup = renderToStaticMarkup(
      <JudgmentPanel
        debate={debate}
        run={run}
        step={0}
        playing={false}
        speed={1}
        snapshot={snapshot}
        restored={[]}
        counts={snapshot.counts}
        caseLineId="e_support"
        onTogglePlay={() => {}}
        onNext={() => {}}
        onPrevious={() => {}}
        onRestart={() => {}}
        onSeek={() => {}}
        onInspectSupport={() => {}}
        onSpeedChange={() => {}}
        onExit={() => {}}
        onNewRun={() => {}}
        onOpenSettings={() => {}}
        onReport={() => {}}
      />
    );

    expect(markup).toContain("Case line");
    expect(markup).toContain("Supporting reason");
    expect(markup).toContain("Strong support");
    expect(markup).toContain("The support directly carries the thesis.");
    expect(markup).toContain("3 links · 2 rulings · 1 support");
    expect(markup).toContain("A case line is being introduced; the first ruling follows.");
    expect(markup).not.toContain("Ruling 01");
  });

  it("keeps a support row future until its case-line cue starts", () => {
    const { debate, run, snapshot } = panelFixture();
    const markup = renderToStaticMarkup(
      <JudgmentPanel
        debate={debate}
        run={run}
        step={0}
        playing={false}
        speed={1}
        snapshot={snapshot}
        restored={[]}
        counts={snapshot.counts}
        onTogglePlay={() => {}}
        onNext={() => {}}
        onPrevious={() => {}}
        onRestart={() => {}}
        onSeek={() => {}}
        onInspectSupport={() => {}}
        onSpeedChange={() => {}}
        onExit={() => {}}
        onNewRun={() => {}}
        onOpenSettings={() => {}}
        onReport={() => {}}
      />
    );

    const supportRow = markup.match(/<button[^>]*record-row--support[^>]*>/)?.[0] ?? "";
    expect(supportRow).toContain("is-future");
    expect(supportRow).not.toContain("is-current");
    expect(markup).not.toContain("Strong support");
  });

  it("highlights only the current ruling when no case line is active", () => {
    const { debate, run, snapshot } = panelFixture();
    const markup = renderToStaticMarkup(
      <JudgmentPanel
        debate={debate}
        run={run}
        step={1}
        playing={false}
        speed={1}
        snapshot={snapshot}
        restored={[]}
        counts={snapshot.counts}
        onTogglePlay={() => {}}
        onNext={() => {}}
        onPrevious={() => {}}
        onRestart={() => {}}
        onSeek={() => {}}
        onInspectSupport={() => {}}
        onSpeedChange={() => {}}
        onExit={() => {}}
        onNewRun={() => {}}
        onOpenSettings={() => {}}
        onReport={() => {}}
      />
    );

    const currentRows = markup.match(/<button[^>]*class="[^"]*is-current[^"]*"[^>]*>[\s\S]*?<\/button>/g) ?? [];
    expect(currentRows).toHaveLength(1);
    expect(currentRows[0]).toContain("Another objection");
    expect(currentRows[0]).not.toContain("record-row--support");
  });

  it("lists every link and can pin a support at the end of the run", () => {
    const { debate, run, snapshot } = panelFixture();
    const markup = renderToStaticMarkup(
      <JudgmentPanel
        debate={debate}
        run={run}
        step={2}
        playing={false}
        speed={1}
        snapshot={snapshot}
        restored={[]}
        counts={snapshot.counts}
        caseLineId="e_support"
        caseLinePinned
        onTogglePlay={() => {}}
        onNext={() => {}}
        onPrevious={() => {}}
        onRestart={() => {}}
        onSeek={() => {}}
        onInspectSupport={() => {}}
        onSpeedChange={() => {}}
        onExit={() => {}}
        onNewRun={() => {}}
        onOpenSettings={() => {}}
        onReport={() => {}}
      />
    );

    expect(markup).toContain("3 links · 2 rulings · 1 support");
    expect(markup).toContain("Another objection");
    expect(markup).toContain("An objection");
    expect(markup).toContain("Strong support");
    expect(markup).toContain("This support contributes to the pro case.");
    const supportRow = markup.match(/<button[^>]*record-row--support[^>]*>/)?.[0] ?? "";
    expect(supportRow).toContain("is-current");
    const currentRows = markup.match(/<button[^>]*class="[^"]*is-current[^"]*"[^>]*>[\s\S]*?<\/button>/g) ?? [];
    expect(currentRows).toHaveLength(1);
  });
});
