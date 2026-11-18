import { PGlite } from "@electric-sql/pglite";
import { randomBytes } from "node:crypto";
import { readdir, readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import pg from "pg";

/**
 * Banco de dados: PGlite (PostgreSQL embarcado, uma instância) ou PostgreSQL/Supabase via DATABASE_URL.
 * A API usa apenas `query`, `exec`, `transaction` e `close`; o adaptador PostgreSQL oferece a mesma interface.
 * A conexão do sistema deve ser superusuário ou ter BYPASSRLS (rotinas, login e roteamento de webhook);
 * as requisições autenticadas assumem o papel restrito `construtora_app` (RLS) dentro de cada transação.
 */
interface Queryable {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; affectedRows?: number }>;
  exec(sql: string): Promise<unknown>;
}
class PgDatabase implements Queryable {
  readonly waitReady = Promise.resolve();
  constructor(
    private pool: pg.Pool,
    private cleanup?: () => Promise<void>,
  ) {
    // erros de conexões ociosas (reinício do servidor etc.) não derrubam o processo
    pool.on("error", (e) => console.error("[db] conexão ociosa:", e.message));
  }
  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]) {
    const r = await this.pool.query(sql, params as unknown[]);
    return { rows: r.rows as T[], affectedRows: r.rowCount ?? 0 };
  }
  async exec(sql: string) {
    await this.pool.query(sql);
  }
  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const tx: Queryable = {
      query: async <R>(sql: string, params?: unknown[]) => {
        const r = await client.query(sql, params as unknown[]);
        return { rows: r.rows as R[], affectedRows: r.rowCount ?? 0 };
      },
      exec: async (sql: string) => {
        await client.query(sql);
      },
    };
    try {
      await client.query("BEGIN");
      const result = await fn(tx);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  async close() {
    await this.pool.end();
    await this.cleanup?.();
  }
}

async function migrate(
  db: Queryable & {
    transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  },
) {
  await db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const directory = fileURLToPath(new URL("../migrations", import.meta.url));
  const files = (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of files) {
    const applied = await db.query(
      "SELECT name FROM schema_migrations WHERE name=$1",
      [name],
    );
    if (applied.rows.length) continue;
    const sql = await readFile(join(directory, name), "utf8");
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query("INSERT INTO schema_migrations(name) VALUES ($1)", [name]);
    });
  }
}

export interface DatabaseOptions {
  dataDir?: string;
  /** PostgreSQL/Supabase (produção). Tem precedência sobre dataDir. */
  databaseUrl?: string;
}
export async function createDatabase(
  options: string | DatabaseOptions = {},
): Promise<PGlite> {
  const opts: DatabaseOptions =
    typeof options === "string" ? { dataDir: options } : options;
  const url = opts.databaseUrl ?? process.env.DATABASE_URL;
  if (url) {
    const pool = new pg.Pool({
      connectionString: url,
      max: Number(process.env.DB_POOL_MAX ?? 10),
    });
    const db = new PgDatabase(pool);
    try {
      await migrate(db);
      return db as unknown as PGlite;
    } catch (error) {
      await pool.end();
      throw error;
    }
  }
  // Somente testes: cada instância ganha um banco novo e descartável no servidor indicado.
  const adminUrl = process.env.TEST_PG_ADMIN_URL;
  if (adminUrl && !opts.dataDir) {
    const name = `ct_${randomBytes(6).toString("hex")}`;
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    const target = new URL(adminUrl);
    target.pathname = `/${name}`;
    const pool = new pg.Pool({ connectionString: target.toString(), max: 8 });
    const db = new PgDatabase(pool, async () => {
      const a = new pg.Client({ connectionString: adminUrl });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await a.end();
    });
    try {
      await migrate(db);
      return db as unknown as PGlite;
    } catch (error) {
      await db.close();
      throw error;
    }
  }
  if (opts.dataDir) await mkdir(opts.dataDir, { recursive: true });
  const db = new PGlite(opts.dataDir);
  await db.waitReady;
  try {
    await migrate(db as unknown as Parameters<typeof migrate>[0]);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
export { seedDatabase } from "./seed.js";
