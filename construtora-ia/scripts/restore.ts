import { resolve } from "node:path";
import { restorePglite } from "../packages/database/src/backup.js";

// Uso: npm run restore -- backups/arquivo.tar.gz  (restaura em DATA_DIR, que deve estar vazio/inexistente)
const file = process.argv[2];
if (!file) {
  console.error(
    "Informe o arquivo de backup: npm run restore -- backups/arquivo.tar.gz",
  );
  process.exit(1);
}
const dataDir = resolve(process.env.DATA_DIR ?? "data/construtora");
await restorePglite(resolve(file), dataDir);
console.log(
  `Backup restaurado em ${dataDir}. Inicie o servidor e confira os dados antes de apagar o diretório antigo.`,
);
