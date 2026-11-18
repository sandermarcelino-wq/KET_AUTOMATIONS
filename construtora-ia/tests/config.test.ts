import { afterEach, expect, it, vi } from "vitest";
import { createApp } from "../apps/api/src/app.js";
afterEach(() => vi.unstubAllEnvs());
it.each([
  ["DRY_RUN", "false"],
  ["NODE_ENV", "production"],
  ["DEV_AUTH_ENABLED", "false"],
])("recusa configuração não simulada %s=%s", async (key, value) => {
  vi.stubEnv(key, value);
  await expect(createApp()).rejects.toThrow("produção está bloqueada");
});
