import { describe, expect, it } from "vitest";
import { seedDebates } from "../core/demo";
import { toArgdown } from "../core/argdown";
import { ArgdownImportError, importArgdown } from "./argdown-import";

const SAMPLE = `# The motion

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

describe("Argdown import", () => {
  it("round-trips an exported debate without losing its graph", async () => {
    const debate = seedDebates()[1]!;
    const source = toArgdown(debate);
    const result = await importArgdown(source);
    expect(result.debate.nodes.length).toBe(debate.nodes.length);
    expect(result.debate.edges.length).toBe(debate.edges.length);
    expect(result.debate.nodes.filter((node) => node.stance === "pro").length).toBeGreaterThan(0);
    expect(result.debate.nodes.filter((node) => node.stance === "con").length).toBeGreaterThan(0);
  });

  it("preserves premise-conclusion structures", async () => {
    const result = await importArgdown(SAMPLE);
    expect(result.debate.nodes.length).toBe(3);
    expect(result.debate.edges.map((edge) => edge.type).sort()).toEqual(["attack", "support"]);
    const pro = result.debate.nodes.find((node) => node.title === "Night workers need it");
    const con = result.debate.nodes.find((node) => node.title === "The demand is too thin");
    expect(pro?.premises).toHaveLength(2);
    expect(pro?.conclusion).toContain("public way home");
    expect(con?.stance).toBe("con");
  });

  it("rejects prose that is not an argument map", async () => {
    await expect(importArgdown("this is just a paragraph about buses")).rejects.toBeInstanceOf(
      ArgdownImportError
    );
  });
});
