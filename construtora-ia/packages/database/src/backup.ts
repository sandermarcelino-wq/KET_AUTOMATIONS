import { PGlite } from "@electric-sql/pglite";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Cópia consistente do banco embarcado (PGlite) em .tar.gz. Para PostgreSQL use pg_dump (ver docs/DEPLOY.md). */
export async function dumpPglite(
  db: PGlite,
  outFile: string,
): Promise<{ file: string; bytes: number }> {
  const blob = await db.dumpDataDir("gzip");
  const buffer = Buffer.from(await blob.arrayBuffer());
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, buffer, { mode: 0o600 });
  return { file: outFile, bytes: buffer.length };
}
/** Restaura um backup em um diretório de dados NOVO (recusa sobrescrever dados existentes). */
export async function restorePglite(
  backupFile: string,
  dataDir: string,
): Promise<void> {
  const existing = await readdir(dataDir).catch(() => [] as string[]);
  if (existing.length)
    throw new Error(
      `O diretório ${dataDir} não está vazio; restaure em um diretório novo ou mova os dados atuais.`,
    );
  await mkdir(dataDir, { recursive: true });
  const bytes = await readFile(backupFile);
  const db = new PGlite(dataDir, {
    loadDataDir: new Blob([new Uint8Array(bytes)]),
  });
  await db.waitReady;
  await db.close();
}
