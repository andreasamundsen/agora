import { ArgdownApplication, ModelPlugin, ParserPlugin, init } from "@argdown/core";
import {
  Debate,
  DebateEdge,
  DebateNode,
  cleanTag,
  cleanText,
  cleanTitle,
  reconcileDebate,
  slugId,
  uniqueId
} from "../core/model";

/**
 * Argdown -> Agora. Uses the official @argdown/core parser and model so any
 * Argdown file the ecosystem accepts (including premise-conclusion structures)
 * can be staged here.
 */

interface ArgdownStatementMember {
  text?: string;
  isTopLevel?: boolean;
  tags?: string[];
}

interface ArgdownSection {
  title?: string;
}

interface ArgdownPcsEntry {
  type?: string;
  title?: string;
  text?: string;
  inference?: unknown;
  argumentTitle?: string;
}

interface ArgdownStatement {
  title: string;
  members?: ArgdownStatementMember[];
  tags?: string[];
  section?: ArgdownSection;
  relations?: unknown[];
  startLine?: number;
  isUsedAsTopLevelStatement?: boolean;
}

interface ArgdownArgument {
  title: string;
  members?: ArgdownStatementMember[];
  pcs?: ArgdownPcsEntry[];
  tags?: string[];
  section?: ArgdownSection;
  startLine?: number;
}

interface ArgdownRelation {
  relationType?: string;
  from?: { title?: string };
  to?: { title?: string };
}

interface ArgdownResponse {
  statements?: Record<string, ArgdownStatement>;
  arguments?: Record<string, ArgdownArgument>;
  relations?: Record<string, ArgdownRelation>;
  parserErrors?: { message?: string; token?: { startLine?: number } }[];
  lexerErrors?: { message?: string; startLine?: number }[];
}

let ready: Promise<void> | null = null;
function ensureInit(): Promise<void> {
  if (!ready) ready = init();
  return ready;
}

function makeApp(): ArgdownApplication {
  const app = new ArgdownApplication();
  app.addPlugin(new ParserPlugin(), "parse-input");
  app.addPlugin(new ModelPlugin(), "build-model");
  return app;
}

function stripTags(text: string): string {
  return text.replace(/(?:^|\s)#[A-Za-z0-9_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function descriptionOf(node: { members?: ArgdownStatementMember[] }): string {
  for (const member of node.members ?? []) {
    if (member.text && member.text.trim()) return cleanText(stripTags(member.text));
  }
  return "";
}

function sectionOf(node: { section?: ArgdownSection }): string {
  return cleanTitle(node.section?.title ?? "", "Crossfire");
}

export interface ImportOptions {
  motion?: string;
  id?: string;
}

export interface ImportResult {
  debate: Debate;
  warnings: string[];
}

export class ArgdownImportError extends Error {
  issues: { message: string; line?: number }[];
  constructor(issues: { message: string; line?: number }[]) {
    super(issues[0]?.message ?? "Could not parse Argdown");
    this.name = "ArgdownImportError";
    this.issues = issues;
  }
}

export async function importArgdown(source: string, options: ImportOptions = {}): Promise<ImportResult> {
  if (!source.trim()) throw new ArgdownImportError([{ message: "The Argdown source is empty." }]);
  await ensureInit();
  const app = makeApp();
  let response: ArgdownResponse;
  try {
    response = app.run({ input: source, process: ["parse-input", "build-model"] }) as ArgdownResponse;
  } catch (error) {
    throw new ArgdownImportError([{ message: error instanceof Error ? error.message : String(error) }]);
  }

  const parserIssues = (response.parserErrors ?? []).map((error) => ({
    message: (error.message ?? "Parser error").split("\n")[0] ?? "Parser error",
    line: error.token?.startLine
  }));
  const lexerIssues = (response.lexerErrors ?? []).map((error) => ({
    message: (error.message ?? "Lexer error").split("\n")[0] ?? "Lexer error",
    line: error.startLine
  }));
  const issues = [...lexerIssues, ...parserIssues];
  if (issues.length) throw new ArgdownImportError(issues.slice(0, 6));

  const statements = response.statements ?? {};
  const argumentsModel = response.arguments ?? {};
  const relations = response.relations ?? {};

  const titled = [...Object.keys(statements), ...Object.keys(argumentsModel)].filter(
    (title) => title.trim() && !/^untitled\b/i.test(title.trim())
  );
  if (!titled.length || (Object.keys(argumentsModel).length === 0 && Object.keys(statements).length < 2)) {
    throw new ArgdownImportError([
      {
        message:
          "No argument map found. A debate needs at least one labelled argument such as “<Claim>: reasoning”, or two statements joined by a relation."
      }
    ]);
  }

  // Map every PCS member (premises and conclusion) back to its argument, so a
  // premise-conclusion structure becomes one argument node with details.
  const pcsOwner = new Map<string, string>();
  const argumentInfo = new Map<string, { premises: string[]; conclusion?: string }>();
  for (const [argumentTitle, argument] of Object.entries(argumentsModel)) {
    const pcs = argument.pcs ?? [];
    const entries = pcs.filter((entry) => (entry.type ?? "statement") === "statement");
    if (!entries.length) continue;
    const premises: string[] = [];
    let conclusion: string | undefined;
    for (const entry of entries) {
      if (entry.title) pcsOwner.set(entry.title, argumentTitle);
      const text = cleanText(stripTags(entry.text ?? ""));
      if (entry.inference) conclusion = text;
      else premises.push(text);
    }
    if (!conclusion && premises.length) conclusion = premises.pop();
    argumentInfo.set(argumentTitle, { premises: premises.filter(Boolean), conclusion });
  }

  const nodes: Partial<DebateNode>[] = [];
  const titleToId = new Map<string, string>();
  const taken = new Set<string>();

  const statementEntries = Object.entries(statements)
    .filter(([title]) => !pcsOwner.has(title))
    .sort((a, b) => (a[1].startLine ?? 0) - (b[1].startLine ?? 0));

  const addNode = (key: string, partial: Partial<DebateNode>) => {
    const id = uniqueId(slugId(partial.title || key, "node"), taken);
    const node: Partial<DebateNode> = { ...partial, id };
    nodes.push(node);
    titleToId.set(key, id);
    const nodeTitle = partial.title || key;
    titleToId.set(nodeTitle, id);
    return node;
  };

  for (const [title, statement] of statementEntries) {
    addNode(title, {
      kind: "statement",
      title: cleanTitle(title),
      text: descriptionOf(statement) || cleanTitle(title),
      stance: "neutral",
      speaker: "moderator",
      tags: (statement.tags ?? []).map(cleanTag).filter(Boolean),
      group: sectionOf(statement),
      premises: []
    });
  }

  for (const [title, argument] of Object.entries(argumentsModel)) {
    const info = argumentInfo.get(title);
    addNode(title, {
      kind: "argument",
      title: cleanTitle(title),
      text: descriptionOf(argument) || cleanTitle(title),
      stance: "neutral",
      speaker: "moderator",
      tags: (argument.tags ?? []).map(cleanTag).filter(Boolean),
      group: sectionOf(argument),
      premises: info?.premises ?? [],
      conclusion: info?.conclusion
    });
  }

  const resolve = (title?: string): string | undefined => {
    if (!title) return undefined;
    const owner = pcsOwner.get(title);
    if (owner) return titleToId.get(owner);
    return titleToId.get(title);
  };

  const edges: Partial<DebateEdge>[] = [];
  const edgeKeys = new Set<string>();
  const warnings: string[] = [];

  for (const relation of Object.values(relations)) {
    const from = resolve(relation.from?.title);
    const to = resolve(relation.to?.title);
    const rawType = relation.relationType ?? "support";
    const type: DebateEdge["type"] | null =
      rawType === "support" ? "support" : rawType === "undercut" ? "undercut" : rawType === "attack" ? "attack" : null;
    if (!type) {
      if (rawType === "contrary" || rawType === "contradiction") {
        if (from && to && from !== to) {
          const key = `${from}|${to}|attack`;
          if (!edgeKeys.has(key)) {
            edgeKeys.add(key);
            edges.push({ from, to, type: "attack" });
          }
        }
      }
      continue;
    }
    if (!from || !to || from === to) continue;
    const key = `${from}|${to}|${type}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push({ from, to, type });
  }

  if (!nodes.length) {
    throw new ArgdownImportError([
      { message: "No statements or arguments were found. Add a definition like [The motion]: … or <An argument>: …" }
    ]);
  }

  // Choose the motion: tag first, then the statement with the most relations,
  // then the first statement in the document.
  const statementNodes = nodes.filter((node) => node.kind === "statement");
  const taggedThesis = statementNodes.find((node) =>
    (node.tags ?? []).some((tag) => tag === "motion" || tag === "thesis")
  );
  const incomingCount = new Map<string, number>();
  for (const edge of edges) {
    if (edge.to) incomingCount.set(edge.to, (incomingCount.get(edge.to) ?? 0) + 1);
  }
  const mostConnected = [...statementNodes].sort(
    (a, b) => (incomingCount.get(b.id!) ?? 0) - (incomingCount.get(a.id!) ?? 0)
  )[0];
  const thesis = taggedThesis ?? mostConnected ?? statementNodes[0];

  if (!thesis) {
    const fallbackTitle = options.motion ?? "The motion";
    addNode(fallbackTitle, {
      kind: "statement",
      title: cleanTitle(fallbackTitle),
      text: cleanText(options.motion ?? fallbackTitle),
      stance: "neutral",
      speaker: "you",
      tags: ["motion"],
      group: "The motion",
      premises: []
    });
    if (edges.length) warnings.push("The file had arguments but no statements, so a neutral motion node was created.");
  }

  const thesisNode = thesis ?? nodes[nodes.length - 1];
  const motion = options.motion?.trim() || thesisNode?.title || "Imported debate";

  const debate = reconcileDebate({
    id: options.id,
    motion,
    thesisId: thesisNode?.id,
    thesisText: thesisNode?.text ?? thesisNode?.title,
    nodes,
    edges,
    origin: "imported",
    chat: [],
    authorNote: "Imported from Argdown. Inspect a node, ask a question about the map, or stage the debate.",
  }, (warning) => warnings.push(warning));

  return { debate, warnings };
}
