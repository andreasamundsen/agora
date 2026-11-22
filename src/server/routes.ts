import { Router, Request, Response } from "express";
import { DebateStore, DebateReadError } from "./store";
import { askDebate, authorDebate } from "./llm";
import { judgeDebate, JudgeCancelledError, MAX_LINKS } from "./judge";
import { ArgdownImportError, importArgdown } from "./argdown-import";
import { toArgdown } from "../core/argdown";
import { isConnected } from "../core/edit";
import { message } from "../core/model";
import { getSettings, isReady, isReasoningEffort, publicSettings, saveSettings, SettingsError } from "./settings";
import { providerUrlProblem } from "../shared/provider-url";
import { testProviderConnection } from "./provider-test";
import { listProviderModels } from "./provider-models";
import type { JudgeProgressEvent } from "../shared/judge-progress";

function unreadableDebate(res: Response): Response {
  return res.status(422).json({
    error: "This debate file could not be read. It was left untouched in the data folder.",
    code: "unreadable-debate"
  });
}

export function createApi(store: DebateStore): Router {
  const api = Router();

  api.get("/health", (_req, res) => {
    const settings = publicSettings();
    res.json({ ok: true, llm: { ready: settings.ready, provider: settings.provider, model: settings.model } });
  });

  api.get("/debates", async (_req, res, next) => {
    try {
      res.json(await store.list());
    } catch (error) {
      next(error);
    }
  });

  api.get("/debates/:id", async (req, res, next) => {
    try {
      const debate = await store.get(req.params.id);
      if (!debate) return res.status(404).json({ error: "Debate not found" });
      res.json({ debate });
    } catch (error) {
      if (error instanceof DebateReadError) {
        return unreadableDebate(res);
      }
      next(error);
    }
  });

  api.post("/debates", async (req, res, next) => {
    try {
      const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
      if (text.length < 6) return res.status(400).json({ error: "Give me a position to debate — a sentence or two is enough." });
      if (text.length > 4000) return res.status(400).json({ error: "That position is too long. Keep it under 4,000 characters." });
      const result = await authorDebate(text);
      const saved = await store.save(result.debate);
      res.status(201).json({
        debate: saved,
        engine: result.engine,
        warning: result.warning
      });
    } catch (error) {
      next(error);
    }
  });

  api.post("/debates/:id/chat", async (req, res, next) => {
    try {
      const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
      if (!text) return res.status(400).json({ error: "Write a message first." });
      if (text.length > 3000) return res.status(400).json({ error: "Keep messages under 3,000 characters." });
      const debate = await store.get(req.params.id);
      if (!debate) return res.status(404).json({ error: "Debate not found" });

      const userChat = [...debate.chat, message("user", text)];
      const warnings = new Set<string>();
      if (userChat.length > 80) {
        warnings.add("Chat history was capped at 80 messages; older messages were dropped.");
      }
      const withUser = await store.save({
        ...debate,
        chat: userChat,
        updatedAt: Date.now()
      });

      const result = await askDebate(withUser, text);
      const chat = [...withUser.chat, message("assistant", result.reply, "note")];
      // A local structural summary already explains its own limits; the
      // response warning still reaches the UI as a transient notice.
      if (result.warning && result.engine !== "local") chat.push(message("system", result.warning, "error"));
      if (chat.length > 80) {
        warnings.add("Chat history was capped at 80 messages; older messages were dropped.");
      }
      const saved = await store.save({ ...withUser, chat, updatedAt: Date.now() });
      if (result.warning) warnings.add(result.warning);
      res.json({ debate: saved, engine: result.engine, warning: warnings.size ? [...warnings].join(" ") : undefined });
    } catch (error) {
      if (error instanceof DebateReadError) return unreadableDebate(res);
      next(error);
    }
  });

  api.patch("/debates/:id", async (req, res, next) => {
    try {
      const body = req.body ?? {};
      if (!Array.isArray(body.nodes) || !Array.isArray(body.edges) || !body.nodes.length) {
        return res.status(400).json({ error: "An edited map needs a node list and a relation list." });
      }
      if (body.nodes.length > 42) {
        return res.status(400).json({ error: "The map is limited to 42 arguments." });
      }
      if (body.nodes.some((node: unknown) => !node || typeof node !== "object" || Array.isArray(node))) {
        return res.status(400).json({ error: "Every node in the edit must be an object." });
      }
      if (body.edges.some((edge: unknown) => !edge || typeof edge !== "object" || Array.isArray(edge))) {
        return res.status(400).json({ error: "Every relation in the edit must be an object." });
      }
      if (body.motion !== undefined && typeof body.motion !== "string") {
        return res.status(400).json({ error: "The motion title must be text." });
      }
      if (body.thesisText !== undefined && typeof body.thesisText !== "string") {
        return res.status(400).json({ error: "The motion text must be text." });
      }

      const existing = await store.get(req.params.id);
      if (!existing) return res.status(404).json({ error: "Debate not found" });
      if (!body.nodes.some((node: { id?: unknown }) => node?.id === existing.thesisId)) {
        return res.status(400).json({ error: "The motion must remain in the edited map." });
      }
      const nodeIds = new Set(body.nodes.map((node: { id?: unknown }) => node?.id));
      if (body.edges.some((edge: { from?: unknown; to?: unknown }) => !nodeIds.has(edge?.from) || !nodeIds.has(edge?.to))) {
        return res.status(400).json({ error: "Every relation must connect two nodes in the edited map." });
      }
      if (!isConnected({ ...existing, nodes: body.nodes, edges: body.edges })) {
        return res.status(400).json({ error: "Every argument must remain connected to the motion." });
      }

      const saved = await store.save({
        ...existing,
        motion: typeof body.motion === "string" ? body.motion : existing.motion,
        thesisText: typeof body.thesisText === "string" ? body.thesisText : existing.thesisText,
        nodes: body.nodes,
        edges: body.edges,
        updatedAt: Date.now()
      });
      res.json({ debate: saved });
    } catch (error) {
      if (error instanceof DebateReadError) return unreadableDebate(res);
      next(error);
    }
  });

  api.post("/debates/:id/judge", async (req, res, next) => {
    try {
      const debate = await store.get(req.params.id);
      if (!debate) return res.status(404).json({ error: "Debate not found" });
      const standard = req.body?.standard;
      const strictness = req.body?.strictness;
      if (standard !== "pro" && standard !== "con" && standard !== "preponderance") {
        return res.status(400).json({ error: "Choose a standard of proof." });
      }
      if (strictness !== "strict" && strictness !== "balanced" && strictness !== "generous") {
        return res.status(400).json({ error: "Choose a strictness for the bench." });
      }
      const model = typeof req.body?.model === "string" ? req.body.model.trim().slice(0, 160) : undefined;
      const linkCount = debate.edges.length;
      if (linkCount > MAX_LINKS) {
        return res.status(400).json({
          error: `This map has ${linkCount} argument links. The bench can hear at most ${MAX_LINKS} in one sitting.`
        });
      }

      if (req.body?.stream !== true) {
        const run = await judgeDebate(debate, { model, standard, strictness });
        return res.json({ run });
      }

      // The progress stream carries work status only; verdicts arrive in the
      // final event after the full run exists.
      res.status(200);
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();

      let closed = false;
      const controller = new AbortController();
      const onClose = () => {
        if (!res.writableEnded) {
          closed = true;
          controller.abort();
        }
      };
      res.on("close", onClose);

      const writeEvent = (event: JudgeProgressEvent) => {
        if (closed || res.writableEnded || res.destroyed) return;
        try {
          res.write(`${JSON.stringify(event)}\n`);
        } catch {
          closed = true;
          controller.abort();
        }
      };

      try {
        const run = await judgeDebate(debate, {
          model,
          standard,
          strictness,
          onProgress: writeEvent,
          signal: controller.signal
        });
        writeEvent({ type: "done", run });
        if (!res.writableEnded) res.end();
      } catch (error) {
        if (error instanceof JudgeCancelledError || controller.signal.aborted) {
          if (!res.writableEnded) res.end();
          return;
        }
        writeEvent({
          type: "error",
          error: error instanceof Error ? error.message : "The bench could not return a judgment."
        });
        if (!res.writableEnded) res.end();
      } finally {
        res.off("close", onClose);
      }
    } catch (error) {
      if (error instanceof DebateReadError) return unreadableDebate(res);
      next(error);
    }
  });

  api.delete("/debates/:id", async (req, res, next) => {
    try {
      await store.delete(req.params.id);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  api.get("/debates/:id/argdown", async (req, res, next) => {
    try {
      const debate = await store.get(req.params.id);
      if (!debate) return res.status(404).type("text/plain").send("Debate not found");
      const slug = debate.motion
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "debate";
      res.setHeader("Content-Disposition", `attachment; filename="${slug}.argdown"`);
      res.type("text/plain; charset=utf-8").send(toArgdown(debate));
    } catch (error) {
      if (error instanceof DebateReadError) {
        return res.status(422).type("text/plain").send("This debate file could not be read. It was left untouched in the data folder.");
      }
      next(error);
    }
  });

  api.post("/import", async (req, res, next) => {
    try {
      const source = typeof req.body?.source === "string" ? req.body.source : "";
      const motion = typeof req.body?.motion === "string" ? req.body.motion.trim() : undefined;
      if (!source.trim()) return res.status(400).json({ error: "Paste or upload an Argdown file first." });
      const { debate, warnings } = await importArgdown(source, { motion });
      const saved = await store.save({ ...debate, chat: [message("assistant", "Imported from Argdown. Inspect a node, ask a question about the map, or stage the debate.", "note")] });
      res.status(201).json({ debate: saved, warnings });
    } catch (error) {
      if (error instanceof ArgdownImportError) {
        return res.status(422).json({ error: error.message, issues: error.issues });
      }
      next(error);
    }
  });

  api.get("/settings", (_req, res) => {
    res.json({ settings: publicSettings() });
  });

  api.put("/settings", (req, res, next) => {
    try {
      const body = req.body ?? {};
      const settings = saveSettings({
        provider: typeof body.provider === "string" ? body.provider : undefined,
        baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : undefined,
        model: typeof body.model === "string" ? body.model : undefined,
        apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
        temperature: typeof body.temperature === "number" ? body.temperature : undefined,
        reasoningEffort: isReasoningEffort(body.reasoningEffort) ? body.reasoningEffort : undefined
      });
      res.json({ settings });
    } catch (error) {
      if (error instanceof SettingsError) return res.status(400).json({ error: error.message });
      next(error);
    }
  });

  api.get("/settings/models", async (_req, res, next) => {
    try {
      const settings = getSettings();
      if (settings.provider === "local") {
        return res.json({ ok: false, models: [], message: "No model mode does not use a model list." });
      }
      const problem = providerUrlProblem(settings.baseUrl, Boolean(settings.apiKey.trim()));
      if (problem) return res.status(400).json({ error: problem });
      res.json(await listProviderModels(settings));
    } catch (error) {
      next(error);
    }
  });

  api.post("/settings/test", async (_req, res, next) => {
    try {
      const settings = getSettings();
      const problem = providerUrlProblem(settings.baseUrl, Boolean(settings.apiKey.trim()));
      if (problem) return res.status(400).json({ error: problem });
      if (!isReady(settings)) {
        return res.json({ ok: false, message: "Add a base URL and model first. Local servers do not need a key." });
      }
      res.json(await testProviderConnection(settings));
    } catch (error) {
      next(error);
    }
  });

  api.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "Unknown API route" });
  });

  return api;
}
