import { build } from "esbuild";

await build({
  entryPoints: ["src/server/index.ts"],
  outfile: "electron/server.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vite"],
  legalComments: "none",
  logLevel: "info"
});
