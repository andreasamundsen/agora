import express from "express";
import path from "node:path";
import { DebateStore } from "./store";
import { createApi } from "./routes";
import { dataDir } from "./settings";
import { isLocalApiRequest } from "./local-access";

const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST?.trim() || "127.0.0.1";
const isProduction = process.env.NODE_ENV === "production" || process.argv.includes("--production");
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'"
].join("; ");

async function main(): Promise<void> {
  try {
    // Node 20.12+; absent .env is fine. Packaged builds must not adopt a
    // provider configuration dropped next to the executable.
    if (process.env.AGORA_PACKAGED !== "1") process.loadEnvFile?.();
  } catch {
    // No .env file — settings and defaults still apply.
  }
  const app = express();
  app.disable("x-powered-by");
  app.use("/api", (req, res, next) => {
    if (!isLocalApiRequest({ host: req.headers.host, origin: req.headers.origin })) {
      return res.status(403).json({ error: "The local API is only available on this machine." });
    }
    next();
  });
  app.use(express.json({ limit: "3mb" }));

  const store = new DebateStore();
  await store.init();
  app.use("/api", createApi(store));

  if (isProduction) {
    app.use((_req, res, next) => {
      res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
      next();
    });
    const dist = path.resolve(process.cwd(), "dist");
    app.use(express.static(dist));
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api")) return next();
      res.sendFile(path.join(dist, "index.html"));
    });
  } else {
    const { createServer } = await import("vite");
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  }

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[agora]", error);
    const text = error instanceof Error ? error.message : "Unexpected server error";
    res.status(500).json({ error: text });
  });

  app.listen(PORT, HOST, () => {
    console.log(`\n  Agora — debate harness`);
    console.log(`  http://${HOST === "127.0.0.1" ? "localhost" : HOST}:${PORT}`);
    console.log(`  data: ${dataDir()}`);
    console.log(`  mode: ${isProduction ? "production" : "development"}\n`);
  });
}

main().catch((error) => {
  console.error("Failed to start Agora:", error);
  process.exit(1);
});
