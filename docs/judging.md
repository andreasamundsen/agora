# Judging

The bench assesses the argument map locally and then resolves it deterministically. This guide covers the local link assessment, the evidence bar, the weighted case, playback, progress, and saved judgments.

[Back to README](../README.md) · [Using Agora](using-agora.md) · [Providers & models](providers.md)


## The bench

`Judge` puts the map on trial. The judgment is built from **local link assessments**: the model sees one arrow at a time — the source claim, the target claim, and the relation type — plus the motion, the thesis, and a compact path placing the target relative to the thesis. The path is orientation, not evidence: it carries titles and relation types, not the other arguments’ text. Every support, attack, and undercut edge is assessed. A deterministic engine then applies the arithmetic below; the model never rates the finished case.

**What a link returns**

| Relation | Model fields | Values used by the engine |
|---|---|---|
| **Support** | `quality`, `confidence`, `reasoning` | `quality`: `strong` / `moderate` / `weak`; `confidence`: `high` / `medium` / `low` |
| **Attack or undercut** | `verdict`, `impact`, `criterion`, `target_component`, `confidence`, `reasoning` | `verdict`: `defeats` / `weakens` / `undecided` / `irrelevant`; `impact`: `decisive` / `material` / `marginal`; `confidence`: `high` / `medium` / `low` |

`criterion` (`relevance`, `grounds`, `sufficiency`, `scope`, `burden`) and `target_component` (`conclusion`, `inference`, `premise`, `scope`, `unknown`) are recorded for the audit trail; they do not enter the arithmetic. Verdict and impact travel together.

An independent **clustering call** runs first. It receives the motion and thesis as framing context plus the text of every argument node, but no statement nodes, edges, verdicts, strengths, or confidence ratings. It returns one cluster per argument. A direct case line inherits its source argument’s cluster. If clustering fails or omits an argument, the missing nodes use their own ids as clusters and a warning is added; clustering is descriptive and never a ruling. The clustering and link calls request temperature `0`; a provider is still free to return a different assessment for the same text.

**Statuses are attack-graph only**

The status calculation is a grounded fixed point over attack and undercut edges. A support edge is not an attacker.

- **Standing:** every attacker is defeated. A node with no attackers also satisfies this.
- **Defeated:** at least one attacker is standing.
- **Contested:** neither condition resolves, including attack cycles that never ground out.

Only a ruling normalized to **`defeats`** enters the attacker graph. `weakens` and `undecided` remain live pressure but do not remove an argument; `irrelevant` is structurally inert. A surviving argument struck by a live `weakens` gets the display condition **weakened**, not a fourth status. The fixed point also produces reinstatement: when the last standing attacker of a defeated argument is itself defeated, the argument can return to standing.

A support edge records that its source is a **reason for** the target. It does **not** make the target depend on the source. All support edges are assessed and appear in the record, but only support edges directly into the thesis enter the weighted case. In a chain `A supports B` and `B supports thesis`, defeating `A` does not by itself change `B`’s status or reduce the weight of `B → thesis`. That is the current semantics, not a hidden aggregation step; Agora does not infer dependency from a support chain.

## Standards and evidence

Choose the **standard of proof** — pro must establish, con must establish, or preponderance — and the **evidence bar**.

**Evidence bar**

The evidence bar is applied to raw `defeats` rulings before statuses are computed. It sets the confidence needed for a strike to remain a strike; it is not the burden and it does not change the line weights directly.

| Evidence bar | `defeats` survives when confidence is | A `defeats` below the bar becomes |
|---|---|---|
| **High** (strict) | `high` | `weakens` for `medium` or `low` |
| **Medium** (balanced) | `high` or `medium` | `undecided` for `low` |
| **Low** (generous) | any confidence | — |

A downgraded ruling still carries its impact into the weighted case; it simply no longer removes its target. The same confidence threshold governs a certified proof and a hard defeat.

**The weighted case**

Only direct relations to the thesis are case lines. Replies affect a direct line through the status and pressure of its source; they are not separately weighted. A direct support is eligible when its source is standing or contested. A direct attack or undercut is eligible when its source is not defeated and its ruling is not `irrelevant`.

```
supportWeight = supportQuality × confidence × pressure × survival × independence
attackWeight  = attackImpact  × confidence × pressure × survival × independence
```

| Factor | Values | Notes |
|---|---|---|
| Support quality | `strong` 3 · `moderate` 2 · `weak` 1 | Pro side |
| Attack impact | `decisive` 3 · `material` 2 · `marginal` 1 | Con side |
| Confidence | `high` 1.0 · `medium` 0.75 · `low` 0.5 | Applied to both sides |
| Survival | Standing 1.0 · Contested 0.5 · Defeated 0 | Defeated sources are omitted |
| Pressure | Clean 1.0 · Standing source under a live attack 0.6 | Contested sources use 1.0, not 0.6 |
| Independence | First line 1.0 · Second 0.5 · Third and later 0.25 | Within one side and one cluster |

A **clean** source has no live incoming attack from a non-defeated source; an `irrelevant` ruling does not dirty it. A contested source already carries the half-survival discount, so it is not also charged the `0.6` pressure discount. A standing source under a live `weakens` or `undecided` attack keeps its structural status but its ordinary case line is discounted at `0.6`. A contested direct attacker is included at survival `0.5` with pressure `1.0`, the same as a contested support.

An edge contributes at most one case line, and only when that edge is a direct relation to the thesis. A support edge elsewhere in the graph contributes no weight of its own. A defeated source contributes no line at all.

**Clusters and repeated points**

Case lines are grouped by **side + source cluster**. Within each group they are sorted by their pre-discount weight; the first keeps full weight, the second is multiplied by `0.5`, and every later line by `0.25`. The group total is then capped at **1.5× its largest line**:

```
clusterTotal = w1 + 0.5·w2 + 0.25·(w3 + w4 + …)
clusterTotal <= 1.5·w1
```

The cap applies after the independence discount. The same cluster can appear on both sides without one side’s cap suppressing the other.

Line weights and totals are rounded to two decimals for reporting and threshold arithmetic. That is accounting hygiene, not a claim of measurement precision.

If any eligible direct line lacks its local assessment, the engine discards the partial rating set and uses one symmetric structural fallback for the whole balance: support `moderate`, attack `material`, confidence `medium`. It awards no proof and no hard defeat in that state. The **local structural review** available without a key always uses this fallback and is a demonstration, not a substantive judgment.

Worked examples, with independence `1.0` and no cluster mates:

| Direct line | Arithmetic | Weight |
|---|---|---:|
| Clean strong, high-confidence support | `3 × 1.0 × 1.0 × 1.0` | 3.00 |
| The same support while a live non-defeating attack is on its source | `3 × 1.0 × 0.6 × 1.0` | 1.80 |
| Contested moderate, medium-confidence support | `2 × 0.75 × 1.0 × 0.5` | 0.75 |
| Clean decisive, high-confidence attack | `3 × 1.0 × 1.0 × 1.0` | 3.00 |

The 3/2/1 support and attack scales are deliberately symmetric so both sides can be compared on one index. Equal top ratings are a normalization; they do not claim that a strong support and a decisive attack are equivalent in the world.

**The burden**

Let `P` be the total pro weight, `C` the total con weight, and `M = P − C`. Under a pro or con burden, the selected side must lead by **at least two points** and hold **3/5 of the weighted case**. The two requirements reduce to one scaled lead:

```
requiredLead = max(2, 0.2 × (P + C))
```

because a 3/5 share is equivalent to a 20% margin. Preponderance uses a proportional deadband instead:

```
preponderanceBand = max(0.5, 0.05 × (P + C))
```

A side must clear the band on either side of zero. At a total of 20 points the band is ±1; an 11–9 record clears it and stands. At a total of 40 points the band is ±2; a 22–18 record clears it and stands, while a 21–19 record sits exactly on the boundary and remains undecided.

The full outcome order is:

1. A certified proof **and** a corroborated hard defeat both exist → **undecided** (a contradictory record; neither side displaces the other).
2. A certified proof exists → **stands**.
3. The thesis is defeated → **falls**.
4. `P <= 0` → **unestablished**.
5. Apply the selected standard:
   - **Preponderance:** with `band = max(0.5, 0.05 × (P + C))`, `M > band` → stands; `M < -band` → falls; otherwise **undecided**.
   - **Pro:** `M >= requiredLead` → stands; `M <= -requiredLead` → falls; otherwise **unestablished**.
   - **Con:** `M <= -requiredLead` → falls; otherwise **stands**.

The standard is applied once, in that final threshold. It is not a second multiplier on the line weights. This is why a 3–2 pro record is unestablished despite a 60% share: its one-point margin does not clear the two-point floor. A 6–4 pro record clears both the floor and the share. An 11–9 pro record does not clear the scaled four-point lead. At the weighted-balance stage under a con burden, with a live pro case, the motion stands unless the con case reaches `-requiredLead`.

`Falls` can be a direct hard defeat or a weighted con win. **Unestablished** means the motion has no effective pro case or the selected pro burden was not met; it is not the same as a con win. **Undecided** is the preponderance deadband or a proof/hard-defeat contradiction.

**Decisive proof and hard defeat**

A direct `defeats` ruling on the thesis is not automatically a final fall. **Proof** and **hard defeat** are symmetric decisive findings:

- A **proof** requires a direct support edge to the thesis whose source is standing and clean, whose support quality is `strong`, and whose confidence meets the selected evidence bar.
- A **hard defeat** requires a direct attack or undercut edge to the thesis whose source is standing and clean, whose ruling is `defeats`, whose impact is `decisive`, and whose confidence meets the same evidence bar.
- A **clean** source has no live incoming attack from a non-defeated source. Proof and hard defeat use the same clean-source rule and the same confidence threshold.
- If both findings exist, the outcome is **undecided**, regardless of the ordinary balance. If the eligible local assessment is missing, or the run is structural, neither finding is available and the weighted balance decides.

A direct `defeats` that lacks a clean, decisive, or sufficiently confident assessment is **withheld**: the thesis becomes contested rather than falling, a warning is recorded, and — if no proof exists — the weighted balance decides. The verdict is not discarded from the record.

**Reading the numbers**

The bench judges **the argument as written on the record**. It has no retrieval, citation, or fact-checking layer, so `✓ Proved` means the support cleared the record’s decisive threshold, not that its factual claims are true. Confidence is the assessor’s clarity about the link, not a measured probability. The point totals are a relative policy index; the fixed factors, repetition discounts, and thresholds are deliberate defaults, not empirical constants. Decimal output is arithmetic, not an accuracy claim. The model’s local ratings supply the inputs; the deterministic code and the selected evidence bar decide the outcome. The model is never asked to reassess the finished map.

## Playback and progress

The playback opens one branch for every argument directly tied to the motion, including a clean support with no clash. Stems alternate between For and Against when both sides have unplayed ones. After a stem is selected, it is drained: follow one response at each fork to the end, backtrack to the nearest unplayed fork under that stem, and follow the next branch. Only when no unplayed replies remain does the next direct stem begin. A support stem gets a visible direct-support beat before its first response.

Judgment controls: `Space` play/pause, `←`/`→` previous/next ruling, click any ruling row to seek, speed selector, and `Esc` to close. During playback, card status changes settle at the end of each ruling's beat; the ruling text is visible while the bench deliberates.

While assessments run, the judge modal streams the links currently being read, a real completed-link count and track, and an ETA that appears after the first link returns and refines after each completion. **×** while the bench is running stops scheduling further links and closes the dialog. A judgment run is a **sidecar**: it never edits the debate, its nodes, or its edges; replay is free.

## Saved judgments

At the finale, **Save judgment** stores the completed sitting with the debate. The Judge setup includes **Bench history → Saved judgments**, where each run shows its date, judge, outcome, and standard; **Open** replays it read-only and **Delete** removes it. Saved runs are independent of the live map: each stores the run record, the final snapshot, and a compact frozen copy of the map. If the map changes later, the saved sitting stays viewable and is marked as recorded from an earlier map. Agora does not auto-save a judgment; use **New run** for a fresh sitting. Saved data lives under `%APPDATA%\Agora\data\judgments` and does not include the API key.

The bench uses the same provider and key as the rest of the app. Its **Judge model** field defaults to your configured model but can be overridden for the run. Each link prompt contains the source claim, the target claim, the relation type, the motion, the thesis, and a compact target-to-thesis path for orientation; it contains no other argument’s full text, no edge notes, no prior verdicts, and no standard of proof. Maps are capped at 80 links per sitting, with four links assessed at a time; a failed link is retried once, then the run aborts. Without a key, the bench runs a **local structural review** that demonstrates the procedure but is not a substantive judgment.
