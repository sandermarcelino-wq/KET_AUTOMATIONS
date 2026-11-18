import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { createApp } from "./app.js";

if (existsSync(".env")) process.loadEnvFile(".env");
const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const port = Number(process.env.PORT ?? 3001);
const hostname = process.env.HOST ?? "127.0.0.1";
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT inválida.");
if (!["127.0.0.1", "localhost", "::1"].includes(hostname))
  throw new Error(
    "Login simulado restrito a loopback; HOST deve ser 127.0.0.1, localhost ou ::1.",
  );
const { app, close, runAllJobs } = await createApp({
  dataDir: resolve(projectRoot, process.env.DATA_DIR ?? "data/construtora"),
});
const staticRoot = resolve(projectRoot, "apps/admin/dist");
if (existsSync(resolve(staticRoot, "index.html"))) {
  app.get("/assets/*", serveStatic({ root: staticRoot }));
  app.get("/", serveStatic({ path: resolve(staticRoot, "index.html") }));
  app.get(
    "/favicon.svg",
    serveStatic({ path: resolve(staticRoot, "favicon.svg") }),
  );
}
const server = serve({ fetch: app.fetch, hostname, port }, () => {
  console.log(`Construtora IA — DRY_RUN: http://${hostname}:${port}`);
  console.log(
    "Autenticação simulada. Banco local persistente. Nenhum envio externo.",
  );
});
// Rotinas (vencimentos, atrasos, prazos de cotação, resumo): a cada JOBS_INTERVAL_MINUTES (padrão 30; 0 desliga).
const jobsEvery = Number(process.env.JOBS_INTERVAL_MINUTES ?? 30);
const jobsTimer =
  jobsEvery > 0
    ? setInterval(
        () =>
          void runAllJobs().catch((e) =>
            console.error(
              "[jobs] falha:",
              e instanceof Error ? e.name : "erro",
            ),
          ),
        jobsEvery * 60_000,
      )
    : undefined;
jobsTimer?.unref();
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(async () => {
    await close();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
