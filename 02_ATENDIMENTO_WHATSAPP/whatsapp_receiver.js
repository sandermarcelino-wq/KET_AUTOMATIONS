import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "redis";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const redis = createClient({ url: process.env.REDIS_URL || "redis://localhost:6379" });

redis.on("error", (err) => console.error("Redis error:", err));
await redis.connect();

// Load agent skill and knowledge base once at startup
const agentSkill = fs.readFileSync(
  path.join(__dirname, ".claude/skills/whatsapp-closer-agent.md"),
  "utf-8"
);

const knowledgeFiles = ["imobiliaria_info.md", "suplementos_catalogo.md", "educacao_digital.md"];
const knowledgeBase = knowledgeFiles
  .map((file) => {
    const filePath = path.join(__dirname, "knowledge", file);
    if (!fs.existsSync(filePath)) return "";
    return `## ${file}\n${fs.readFileSync(filePath, "utf-8")}`;
  })
  .filter(Boolean)
  .join("\n\n");

const SYSTEM_PROMPT = `${agentSkill}

---

# Base de Conhecimento

${knowledgeBase}`;

const HISTORY_TTL_SECONDS = 60 * 60 * 24; // 24 hours
const MAX_HISTORY_MESSAGES = 20;

async function getHistory(phoneNumber) {
  const raw = await redis.get(`chat:${phoneNumber}`);
  return raw ? JSON.parse(raw) : [];
}

async function saveHistory(phoneNumber, messages) {
  const trimmed = messages.slice(-MAX_HISTORY_MESSAGES);
  await redis.set(`chat:${phoneNumber}`, JSON.stringify(trimmed), {
    EX: HISTORY_TTL_SECONDS,
  });
}

async function generateReply(phoneNumber, incomingText) {
  const history = await getHistory(phoneNumber);

  history.push({ role: "user", content: incomingText });

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: history,
  });

  const replyText = response.content[0].text;

  history.push({ role: "assistant", content: replyText });
  await saveHistory(phoneNumber, history);

  return replyText;
}

// Webhook endpoint — expects the standard Evolution API / Z-API / WPPConnect payload
app.post("/webhook/whatsapp", async (req, res) => {
  try {
    const body = req.body;

    // Normalize payload: support Evolution API and Z-API shapes
    const rawPhone =
      body?.data?.key?.remoteJid?.replace("@s.whatsapp.net", "") ||
      body?.phone ||
      body?.from;

    // Strip Brazil country code (55) so the Redis key matches the local number
    // e.g. "5535998247070" → "35998247070"
    const phone = rawPhone?.replace(/^55(\d{10,11})$/, "$1");

    const messageText =
      body?.data?.message?.conversation ||
      body?.data?.message?.extendedTextMessage?.text ||
      body?.text ||
      body?.message;

    if (!phone || !messageText) {
      return res.status(400).json({ error: "Missing phone or message" });
    }

    console.log(`[IN]  ${phone}: ${messageText}`);

    const reply = await generateReply(phone, messageText);

    console.log(`[OUT] ${phone}: ${reply}`);

    // If agent requests human takeover, flag it
    if (reply.includes("[TRANSFER_TO_HUMAN]")) {
      return res.json({
        phone,
        reply,
        transferToHuman: true,
      });
    }

    return res.json({ phone, reply, transferToHuman: false });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Health check
app.get("/health", (_req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`WhatsApp receiver running on port ${PORT}`));
