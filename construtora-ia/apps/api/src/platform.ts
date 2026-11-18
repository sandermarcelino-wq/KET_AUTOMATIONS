import type { Hono } from "hono";
import { z } from "zod";
import type { PGlite } from "@electric-sql/pglite";
import { ApiError, type Env } from "./common.js";
import { dumpPglite } from "../../../packages/database/src/backup.js";
import { planInfo } from "./services.js";

/** Operações do operador da plataforma (SaaS). Exigem PLATFORM_ADMIN_TOKEN; desligadas se a variável não existir. */
export function registerPlatform(app: Hono<Env>, db: PGlite) {
  const guard = (header: string | undefined) => {
    const token = process.env.PLATFORM_ADMIN_TOKEN;
    if (!token || token.length < 24)
      throw new ApiError(404, "Rota não encontrada.");
    if (header !== token)
      throw new ApiError(403, "Token do operador inválido.");
  };
  app.get("/api/platform/tenants", async (c) => {
    guard(c.req.header("x-platform-admin"));
    const tenants = (
      await db.query<{ id: string; name: string }>(
        "SELECT id, name FROM tenants ORDER BY name",
      )
    ).rows;
    return c.json(
      await Promise.all(
        tenants.map(async (t) => ({
          ...t,
          ...(await planInfo(db as never, t.id)),
        })),
      ),
    );
  });
  /** Backup a quente do banco embarcado (PGlite). Com PostgreSQL use pg_dump. */
  app.post("/api/platform/backup", async (c) => {
    guard(c.req.header("x-platform-admin"));
    if (typeof (db as { dumpDataDir?: unknown }).dumpDataDir !== "function")
      throw new ApiError(
        409,
        "Banco PostgreSQL externo: use pg_dump (ver docs/DEPLOY.md).",
      );
    const dir = process.env.BACKUP_DIR ?? "backups";
    const file = `${dir}/construtora-${new Date().toISOString().replace(/[:.]/g, "-")}.tar.gz`;
    const r = await dumpPglite(db, file);
    return c.json({ file: r.file, bytes: r.bytes });
  });
  app.post("/api/platform/tenants/:id/plan", async (c) => {
    guard(c.req.header("x-platform-admin"));
    const num = z.number().int().min(0).max(1_000_000_000).nullable();
    const body = z
      .object({
        plan: z.string().trim().min(2).max(40),
        limits: z
          .object({
            worksites: num,
            users: num,
            storageMb: num,
            messagesPerMonth: num,
            aiCallsPerMonth: num,
          })
          .strict(),
      })
      .strict()
      .parse(await c.req.json());
    const exists = (
      await db
        .query("SELECT 1 FROM tenants WHERE id=$1", [c.req.param("id")])
        .catch(() => ({ rows: [] }))
    ).rows.length;
    if (!exists) throw new ApiError(404, "Empresa não encontrada.");
    await db.query(
      "INSERT INTO tenant_plans(tenant_id,data) VALUES($1,$2) ON CONFLICT (tenant_id) DO UPDATE SET data=EXCLUDED.data",
      [c.req.param("id"), JSON.stringify(body)],
    );
    return c.json({ ok: true });
  });
}
