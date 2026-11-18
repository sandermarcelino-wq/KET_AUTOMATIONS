import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export async function createDatabase(dataDir?: string): Promise<PGlite> {
  if (dataDir) await mkdir(dataDir, { recursive: true });
  const db = new PGlite(dataDir);
  await db.waitReady;
  try {
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
        await tx.query("INSERT INTO schema_migrations(name) VALUES ($1)", [
          name,
        ]);
      });
    }
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
export { seedDatabase } from "./seed.js";
