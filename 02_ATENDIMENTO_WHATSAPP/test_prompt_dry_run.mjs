// Dry-run: verifica se o system prompt é montado corretamente e se a
// normalização do telefone produz a chave Redis esperada.
// Não chama Anthropic API nem Redis — apenas lê arquivos locais.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 1. Carrega skill e knowledge (mesma lógica do whatsapp_receiver.js) ──────

const agentSkill = fs.readFileSync(
  path.join(__dirname, ".claude/skills/whatsapp-closer-agent.md"),
  "utf-8"
);

const knowledgeFiles = ["imobiliaria_info.md", "suplementos_catalogo.md", "educacao_digital.md"];
const knowledgeBase = knowledgeFiles
  .map((file) => {
    const filePath = path.join(__dirname, "knowledge", file);
    if (!fs.existsSync(filePath)) return `[AUSENTE: ${file}]`;
    return `## ${file}\n${fs.readFileSync(filePath, "utf-8")}`;
  })
  .join("\n\n");

const SYSTEM_PROMPT = `${agentSkill}\n\n---\n\n# Base de Conhecimento\n\n${knowledgeBase}`;

// ── 2. Verifica conteúdo crítico ──────────────────────────────────────────────

const checks = [
  { label: "Jardins presente no system prompt",  pass: SYSTEM_PROMPT.includes("Jardins") },
  { label: "LAVVI presente (base de comparação)", pass: SYSTEM_PROMPT.includes("LAVVI") },
  { label: "Quiet Luxury presente",              pass: SYSTEM_PROMPT.includes("Quiet Luxury") },
  { label: "Objeções presentes",                 pass: SYSTEM_PROMPT.includes("## Objeções") },
  { label: "Gatilho de visita (10h ou 14h)",     pass: SYSTEM_PROMPT.includes("10h ou 14h") },
  { label: "Regra TRANSFER_TO_HUMAN presente",   pass: SYSTEM_PROMPT.includes("[TRANSFER_TO_HUMAN]") },
];

console.log("\n=== VERIFICAÇÃO DO SYSTEM PROMPT ===\n");
let allPassed = true;
for (const { label, pass } of checks) {
  const icon = pass ? "✅" : "❌";
  console.log(`${icon}  ${label}`);
  if (!pass) allPassed = false;
}

// ── 3. Simula normalização de telefone ───────────────────────────────────────

const rawPhones = ["5535998247070", "35998247070", "5511999999999", "11999999999"];
console.log("\n=== NORMALIZAÇÃO DE TELEFONE (chave Redis) ===\n");
for (const raw of rawPhones) {
  const normalized = raw.replace(/^55(\d{10,11})$/, "$1");
  const redisKey = `chat:${normalized}`;
  console.log(`  raw: ${raw.padEnd(15)}→  key: ${redisKey}`);
}

// ── 4. Simula payload Evolution API e mostra o que seria enviado ─────────────

const fakePayload = {
  data: {
    key: { remoteJid: "5535998247070@s.whatsapp.net" },
    message: { conversation: "Qual o diferencial desse prédio em relação ao da LAVVI?" },
  },
};

const rawPhone =
  fakePayload?.data?.key?.remoteJid?.replace("@s.whatsapp.net", "");
const phone = rawPhone?.replace(/^55(\d{10,11})$/, "$1");
const messageText = fakePayload?.data?.message?.conversation;

console.log("\n=== SIMULAÇÃO DE PAYLOAD ===\n");
console.log(`  Telefone extraído : ${rawPhone}`);
console.log(`  Telefone Redis    : ${phone}  →  chave: chat:${phone}`);
console.log(`  Mensagem extraída : "${messageText}"`);

// ── 5. Trecho do system prompt relevante para a pergunta sobre LAVVI ─────────

const lavviIdx = SYSTEM_PROMPT.indexOf("LAVVI");
const snippet = SYSTEM_PROMPT.slice(Math.max(0, lavviIdx - 120), lavviIdx + 300);
console.log("\n=== TRECHO DO SYSTEM PROMPT COM 'LAVVI' ===\n");
console.log(snippet);

console.log("\n" + (allPassed ? "✅ Todos os checks passaram." : "❌ Há checks falhando — revisar.") + "\n");
