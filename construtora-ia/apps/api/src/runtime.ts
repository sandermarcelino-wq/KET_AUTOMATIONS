import { randomBytes } from "node:crypto";
import {
  ClaudeAI,
  MockAIProvider,
  SmtpMailer,
  SttClient,
  WhatsAppCloud,
  type AIProvider,
  type MailInput,
} from "../../../packages/integrations/src/index.js";

/** Integrações em tempo de execução. Tudo desligado (simulado) por padrão; credenciais só por ambiente. */
export interface Integrations {
  /** true = mensagens de saída vão para a fila real da WhatsApp Cloud API. */
  live: boolean;
  whatsapp: {
    appSecret: string | null;
    verifyToken: string | null;
    accessToken: string | null;
    client: WhatsAppCloud | null;
    genericTemplate: { name: string; language: string } | null;
    approvalSecret: string;
  };
  ai: AIProvider;
  stt: SttClient | null;
  mailer: { send(m: MailInput): Promise<void> } | null;
  now: () => Date;
}
export function integrationsFromEnv(env = process.env): Integrations {
  const live = env.WHATSAPP_LIVE === "true" && env.DRY_RUN === "false";
  const accessToken = env.META_ACCESS_TOKEN || null;
  const tpl = env.WHATSAPP_GENERIC_TEMPLATE?.split(":");
  return {
    live,
    whatsapp: {
      appSecret: env.META_APP_SECRET || null,
      verifyToken: env.META_VERIFY_TOKEN || null,
      accessToken,
      client:
        live && accessToken
          ? new WhatsAppCloud({ accessToken, apiVersion: env.META_API_VERSION })
          : null,
      genericTemplate:
        tpl && tpl[0] ? { name: tpl[0], language: tpl[1] || "pt_BR" } : null,
      approvalSecret:
        env.APPROVAL_CODE_SECRET || randomBytes(32).toString("hex"),
    },
    ai: env.ANTHROPIC_API_KEY
      ? new ClaudeAI({
          apiKey: env.ANTHROPIC_API_KEY,
          model: env.ANTHROPIC_MODEL,
        })
      : new MockAIProvider(),
    stt:
      env.STT_API_URL && env.STT_API_KEY
        ? new SttClient({
            url: env.STT_API_URL,
            apiKey: env.STT_API_KEY,
            model: env.STT_MODEL,
          })
        : null,
    mailer:
      env.SMTP_HOST && env.SMTP_FROM
        ? new SmtpMailer({
            host: env.SMTP_HOST,
            port: Number(env.SMTP_PORT ?? 587),
            user: env.SMTP_USER,
            pass: env.SMTP_PASS,
            from: env.SMTP_FROM,
          })
        : null,
    now: () => new Date(),
  };
}
