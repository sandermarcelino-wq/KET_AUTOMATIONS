import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../apps/api/src/app.js";
import { createDatabase } from "../packages/database/src/index.js";
import { restorePglite } from "../packages/database/src/backup.js";

describe("backup e restauração do banco embarcado", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "construtora-bkp-"));
    vi.stubEnv("PLATFORM_ADMIN_TOKEN", "b".repeat(32));
    vi.stubEnv("BACKUP_DIR", join(dir, "backups"));
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });
  it("gera backup a quente por rota protegida e restaura em diretório novo com os mesmos dados", async () => {
    // Este teste usa PGlite em disco (não se aplica a PostgreSQL externo).
    vi.stubEnv("TEST_PG_ADMIN_URL", "");
    const app = await createApp({
      dataDir: join(dir, "data"),
      devAuth: false,
      signupEnabled: true,
      seed: false,
    });
    const signup = await app.app.request("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        companyName: "Empresa Backup",
        ownerName: "Dono",
        email: "dono@backup.com",
        phone: "+5511966660000",
        password: "Senha-Forte-2026",
      }),
    });
    expect(signup.status).toBe(201);
    const noToken = await app.app.request("/api/platform/backup", {
      method: "POST",
    });
    expect(noToken.status).toBe(403);
    const ok = await app.app.request("/api/platform/backup", {
      method: "POST",
      headers: { "x-platform-admin": "b".repeat(32) },
    });
    expect(ok.status).toBe(200);
    const { file, bytes } = (await ok.json()) as {
      file: string;
      bytes: number;
    };
    expect(bytes).toBeGreaterThan(1000);
    await app.close();
    const restored = join(dir, "restored");
    await restorePglite(file, restored);
    await expect(restorePglite(file, restored)).rejects.toThrow(
      /não está vazio/,
    ); // nunca sobrescreve
    const db = await createDatabase({ dataDir: restored });
    expect(
      (await db.query<{ name: string }>("SELECT name FROM tenants")).rows.map(
        (r) => r.name,
      ),
    ).toEqual(["Empresa Backup"]);
    expect((await db.query("SELECT email FROM users")).rows).toEqual([
      { email: "dono@backup.com" },
    ]);
    await db.close();
  });
});
