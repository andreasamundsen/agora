import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { reconcileDebate } from "../../core/model";
import {
  buildJudgmentRecord,
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

function orderFor(run: ReturnType<typeof buildJudgmentRun>, edgeId: string): number {
  return buildJudgmentRecord(run).find((entry) =>
    entry.kind === "support" ? entry.support.edgeId === edgeId : entry.verdict.edgeId === edgeId
  )?.order ?? 0;
}

describe("JudgmentPanel unified record", () => {
  it("shows the opening support instead of the numbered ruling while a case line is active", () => {
    const { debate, run, snapshot } = panelFixture();
    const markup = renderToStaticMarkup(
      <JudgmentPanel
        debate={debate}
        run={run}
        step={0}
        currentOrder={orderFor(run, "e_support")}
        finished={false}
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
    expect(markup).toContain("This support contributes to the pro case.");
    expect(markup).not.toContain("Ruling 01");
    expect(markup).not.toContain("One ruling at a time.");
    const supportRow = markup.match(/<button[^>]*record-row--support[^>]*>/)?.[0] ?? "";
    expect(supportRow).toContain("is-current");
    expect(supportRow).not.toContain("is-future");
  });

  it("keeps a support row future until its case-line cue starts", () => {
    const { debate, run, snapshot } = panelFixture();
    const markup = renderToStaticMarkup(
      <JudgmentPanel
        debate={debate}
        run={run}
        step={0}
        currentOrder={0}
        finished={false}
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
    expect(supportRow).not.toContain("disabled");
    expect(markup).not.toContain("Strong support");
  });

  it("highlights only the current ruling when no case line is active", () => {
    const { debate, run, snapshot } = panelFixture();
    const markup = renderToStaticMarkup(
      <JudgmentPanel
        debate={debate}
        run={run}
        step={1}
        currentOrder={orderFor(run, "e_objection2")}
        finished={false}
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

  it("gives a final support its own card, then a separate completed judgment", () => {
    const { debate, run, snapshot } = panelFixture();
    const finalRun = { ...run, waves: [] };
    const record = buildJudgmentRecord(finalRun);
    const supportOrder = record.find((entry) => entry.kind === "support")?.order ?? 0;
    expect(record[record.length - 1]?.kind).toBe("support");
    expect(supportOrder).toBe(record.length);

    const common = {
      debate,
      run: finalRun,
      step: finalRun.verdicts.length,
      playing: false,
      speed: 1,
      snapshot,
      restored: [],
      counts: snapshot.counts,
      onTogglePlay: () => {},
      onNext: () => {},
      onPrevious: () => {},
      onRestart: () => {},
      onSeek: () => {},
      onSpeedChange: () => {},
      onExit: () => {},
      onNewRun: () => {},
      onOpenSettings: () => {},
      onReport: () => {}
    };

    const supportBeat = renderToStaticMarkup(
      <JudgmentPanel {...common} currentOrder={supportOrder} finished={false} caseLineId="e_support" />
    );
    expect(supportBeat).toContain("Case line");
    expect(supportBeat).toContain("This support contributes to the pro case.");
    expect(supportBeat).not.toContain("judgment-finale");
    expect(supportBeat).not.toContain("Final judgment");
    expect(supportBeat.match(/record-row[^>]*is-current/)).toHaveLength(1);

    const finished = renderToStaticMarkup(
      <JudgmentPanel {...common} currentOrder={record.length} finished finalSeen />
    );
    expect(finished).toContain("judgment-finale");
    expect(finished).not.toContain("ruling-card--case-line");
    expect(finished).toContain("Final judgment");
    expect(finished).toContain("record-final is-current");
    expect(finished).not.toMatch(/record-row[^>]*is-current/);
  });

  it("keeps the final-judgment row reachable after selecting a record entry", () => {
    const { debate, run, snapshot } = panelFixture();
    const supportOrder = orderFor(run, "e_support");
    const markup = renderToStaticMarkup(
      <JudgmentPanel
        debate={debate}
        run={run}
        step={0}
        currentOrder={supportOrder}
        finished={false}
        finalSeen
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
        onShowFinal={() => {}}
        onSpeedChange={() => {}}
        onExit={() => {}}
        onNewRun={() => {}}
        onOpenSettings={() => {}}
        onReport={() => {}}
      />
    );

    expect(markup).toContain("3 links · 2 rulings · 1 support");
    expect(markup).toContain("Final judgment");
    expect(markup).not.toContain("record-final is-current");
    expect(markup.match(/record-row[^>]*is-current/)).toHaveLength(1);
  });

  it("lists every link and selects a support without a competing ruling highlight", () => {
    const { debate, run, snapshot } = panelFixture();
    const markup = renderToStaticMarkup(
      <JudgmentPanel
        debate={debate}
        run={run}
        step={2}
        currentOrder={orderFor(run, "e_support")}
        finished={false}
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
    expect(markup).not.toContain("judgment-finale");
    const supportRow = markup.match(/<button[^>]*record-row--support[^>]*>/)?.[0] ?? "";
    expect(supportRow).toContain("is-current");
    expect(supportRow).not.toContain("disabled");
    const currentRows = markup.match(/<button[^>]*class="[^"]*is-current[^"]*"[^>]*>[\s\S]*?<\/button>/g) ?? [];
    expect(currentRows).toHaveLength(1);
    expect(currentRows[0]).toContain("Supporting reason");
  });

  it("offers an explicit save on a live finale and marks a saved record read-only", () => {
    const { debate, run, snapshot } = panelFixture();
    const record = buildJudgmentRecord(run);
    const common = {
      debate,
      run,
      step: run.verdicts.length,
      currentOrder: record.length,
      finished: true,
      finalSeen: true,
      playing: false,
      speed: 1,
      snapshot,
      restored: [],
      counts: snapshot.counts,
      onTogglePlay: () => {},
      onNext: () => {},
      onPrevious: () => {},
      onRestart: () => {},
      onSeek: () => {},
      onSpeedChange: () => {},
      onExit: () => {},
      onNewRun: () => {},
      onOpenSettings: () => {},
      onReport: () => {},
      onSave: () => {}
    };

    const live = renderToStaticMarkup(<JudgmentPanel {...common} />);
    expect(live).toContain("Save judgment");
    expect(live).toContain("Download report");
    expect(live).not.toContain("Recorded judgment");
    expect(live).not.toContain("Saved judgment");

    const saved = renderToStaticMarkup(<JudgmentPanel {...common} savedAt={Date.now()} />);
    expect(saved).toContain("Recorded judgment");
    expect(saved).toContain("Saved judgment");
    expect(saved).toContain("this record is read-only");
    expect(saved).not.toContain(">Save judgment<");

    const stale = renderToStaticMarkup(<JudgmentPanel {...common} savedAt={Date.now()} stale />);
    expect(stale).toContain("Recorded from an earlier map");
    expect(stale).toContain("the live map has changed since this sitting");
  });
});
