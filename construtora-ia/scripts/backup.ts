import { resolve } from "node:path";
import { createDatabase } from "../packages/database/src/index.js";
import { dumpPglite } from "../packages/database/src/backup.js";

// Uso (com o servidor PARADO): npm run backup [-- destino.tar.gz]
if (process.env.DATABASE_URL) {
  console.log(
    'DATABASE_URL definido: use pg_dump, por exemplo:\n  pg_dump --format=custom --file=backup.dump "$DATABASE_URL"\n(ver docs/DEPLOY.md)',
  );
  process.exit(0);
}
const dataDir = resolve(process.env.DATA_DIR ?? "data/construtora");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = resolve(process.argv[2] ?? `backups/construtora-${stamp}.tar.gz`);
const db = await createDatabase({ dataDir });
try {
  const r = await dumpPglite(db, out);
  console.log(
    `Backup gravado em ${r.file} (${(r.bytes / 1024).toFixed(0)} KB). Guarde uma cópia fora deste servidor.`,
  );
} finally {
  await db.close();
}
