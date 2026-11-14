import { Router, Request, Response } from "express";
import { DebateStore } from "./store";
import { authorDebate, extendDebate } from "./llm";
import { judgeDebate, MAX_CLASHES } from "./judge";
import { ArgdownImportError, importArgdown } from "./argdown-import";
import { toArgdown } from "../core/argdown";
import { message } from "../core/model";
import { getSettings, isReady, publicSettings, saveSettings } from "./settings";

export function createApi(store: DebateStore): Router {
  const api = Router();

  api.get("/health", (_req, res) => {
    const settings = publicSettings();
    res.json({ ok: true, llm: { ready: settings.ready, provider: settings.provider, model: settings.model } });
  });

  api.get("/debates", async (_req, res, next) => {
    try {
      res.json({ debates: await store.list() });
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

      const withUser = await store.save({
        ...debate,
        chat: [...debate.chat, message("user", text)],
        updatedAt: Date.now()
      });

      const result = await extendDebate(withUser, text);
      const chat = [...result.debate.chat, message("assistant", result.reply, "expand")];
      if (result.warning) chat.push(message("system", result.warning, "error"));
      const saved = await store.save({ ...result.debate, chat, updatedAt: Date.now() });
      res.json({ debate: saved, engine: result.engine, warning: result.warning });
    } catch (error) {
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
      const clashCount = debate.edges.filter((edge) => edge.type === "attack" || edge.type === "undercut").length;
      if (clashCount > MAX_CLASHES) {
        return res.status(400).json({
          error: `This map has ${clashCount} clashes. The bench can hear at most ${MAX_CLASHES} in one sitting.`
        });
      }
      const run = await judgeDebate(debate, { model, standard, strictness });
      res.json({ run });
    } catch (error) {
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
      next(error);
    }
  });

  api.post("/import", async (req, res, next) => {
    try {
      const source = typeof req.body?.source === "string" ? req.body.source : "";
      const motion = typeof req.body?.motion === "string" ? req.body.motion.trim() : undefined;
      if (!source.trim()) return res.status(400).json({ error: "Paste or upload an Argdown file first." });
      const { debate, warnings } = await importArgdown(source, { motion });
      const saved = await store.save({ ...debate, chat: [message("assistant", "Imported from Argdown. Inspect a node, ask for a missing argument, or stage the debate.", "note")] });
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

  api.put("/settings", (req, res) => {
    const body = req.body ?? {};
    const settings = saveSettings({
      provider: typeof body.provider === "string" ? body.provider : undefined,
      baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : undefined,
      model: typeof body.model === "string" ? body.model : undefined,
      apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
      temperature: typeof body.temperature === "number" ? body.temperature : undefined
    });
    res.json({ settings });
  });

  api.post("/settings/test", async (_req, res, next) => {
    try {
      const settings = getSettings();
      if (!isReady(settings)) {
        return res.json({ ok: false, message: "Add a base URL and model first. Local servers such as LM Studio or Ollama do not need a key." });
      }
      const base = settings.baseUrl.replace(/\/+$/, "");
      const started = Date.now();
      const auth: Record<string, string> = settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {};
      const models = await fetch(`${base}/models`, { headers: auth }).catch(() => null);
      if (models?.ok) {
        return res.json({ ok: true, message: `Connected to ${settings.model}.`, latencyMs: Date.now() - started });
      }
      const chat = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify({
          model: settings.model,
          messages: [{ role: "user", content: "Reply with the single word: ready" }],
          max_tokens: 8,
          temperature: 0
        })
      });
      if (!chat.ok) {
        const detail = (await chat.text().catch(() => "")).slice(0, 300);
        return res.json({ ok: false, message: `Provider rejected the request (${chat.status}). ${detail}` });
      }
      res.json({ ok: true, message: `Connected to ${settings.model}.`, latencyMs: Date.now() - started });
    } catch (error) {
      next(error);
    }
  });

  api.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "Unknown API route" });
  });

  return api;
}
