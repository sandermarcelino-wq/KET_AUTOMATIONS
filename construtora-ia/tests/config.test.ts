import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../apps/api/src/app.js";
import { resolveConfig } from "../apps/api/src/config.js";

afterEach(() => vi.unstubAllEnvs());
describe("configuração segura de execução", () => {
  it("padrão de desenvolvimento: login de desenvolvimento, dados de demonstração e modo simulado", () => {
    const c = resolveConfig({});
    expect(c).toMatchObject({
      production: false,
      dryRun: true,
      devAuth: true,
      live: false,
      seedDemo: true,
    });
  });
  it.each([
    [
      { NODE_ENV: "production", DEV_AUTH_ENABLED: "true" },
      /produção.*login de desenvolvimento/,
    ],
    [{ NODE_ENV: "production", SEED_DEMO: "true" }, /Dados de demonstração/],
    [{ DRY_RUN: "false" }, /DRY_RUN=false exige autenticação real/],
    [{ WHATSAPP_LIVE: "true" }, /exige DRY_RUN=false/],
    [
      { DRY_RUN: "false", DEV_AUTH_ENABLED: "false", WHATSAPP_LIVE: "true" },
      /META_APP_SECRET, META_VERIFY_TOKEN, META_ACCESS_TOKEN, APPROVAL_CODE_SECRET/,
    ],
    [{ DRY_RUN: "talvez" }, /DRY_RUN deve ser/],
  ])("recusa configuração insegura %j", (env, message) => {
    expect(() => resolveConfig(env as NodeJS.ProcessEnv)).toThrow(message);
  });
  it("produção é segura por padrão: autenticação real e sem dados de demonstração", () => {
    const c = resolveConfig({ NODE_ENV: "production" });
    expect(c).toMatchObject({
      devAuth: false,
      seedDemo: false,
      signupEnabled: false,
    });
  });
  it("produção válida: autenticação real, sem demonstração, HSTS e cadastro desligado por padrão", () => {
    const c = resolveConfig({
      NODE_ENV: "production",
      DEV_AUTH_ENABLED: "false",
      SEED_DEMO: "false",
    });
    expect(c).toMatchObject({
      production: true,
      devAuth: false,
      seedDemo: false,
      hsts: true,
      signupEnabled: false,
      live: false,
    });
  });
  it("modo real completo é aceito apenas com todas as credenciais", () => {
    const env = {
      NODE_ENV: "production",
      DEV_AUTH_ENABLED: "false",
      SEED_DEMO: "false",
      DRY_RUN: "false",
      WHATSAPP_LIVE: "true",
      META_APP_SECRET: "a",
      META_VERIFY_TOKEN: "b",
      META_ACCESS_TOKEN: "c",
      APPROVAL_CODE_SECRET: "d",
    };
    expect(resolveConfig(env).live).toBe(true);
  });
  it.each([
    ["DRY_RUN", "false"],
    ["NODE_ENV", "production"],
    ["WHATSAPP_LIVE", "true"],
  ])(
    "createApp recusa %s=%s com o login de desenvolvimento ativo",
    async (key, value) => {
      vi.stubEnv("DEV_AUTH_ENABLED", "true");
      vi.stubEnv(key, value);
      await expect(createApp()).rejects.toThrow(
        /Configuração insegura recusada/,
      );
    },
  );
});
