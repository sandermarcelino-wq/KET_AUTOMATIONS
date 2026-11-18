/** Configuração de execução e proteções contra operação insegura. */
export interface RuntimeConfig {
  production: boolean;
  dryRun: boolean;
  devAuth: boolean;
  live: boolean;
  seedDemo: boolean;
  signupEnabled: boolean;
  hsts: boolean;
  trustProxy: boolean;
  sessionHours: number;
  signupRatePerHour: number;
}
export function resolveConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<RuntimeConfig> = {},
): RuntimeConfig {
  const production = env.NODE_ENV === "production";
  if (env.DRY_RUN !== undefined && !["true", "false"].includes(env.DRY_RUN))
    throw new Error("DRY_RUN deve ser true ou false.");
  const dryRun = env.DRY_RUN !== "false";
  const devAuth =
    overrides.devAuth ??
    (env.DEV_AUTH_ENABLED !== undefined
      ? env.DEV_AUTH_ENABLED === "true"
      : !production);
  const live = env.WHATSAPP_LIVE === "true";
  const seedDemo =
    overrides.seedDemo ??
    (env.SEED_DEMO !== undefined ? env.SEED_DEMO === "true" : !production);
  const problems: string[] = [];
  if (production && devAuth)
    problems.push(
      "Em produção o login de desenvolvimento deve estar desligado (DEV_AUTH_ENABLED=false) — autenticação real é obrigatória.",
    );
  if (!dryRun && devAuth)
    problems.push(
      "DRY_RUN=false exige autenticação real (DEV_AUTH_ENABLED=false).",
    );
  if (production && seedDemo)
    problems.push(
      "Dados de demonstração não são permitidos em produção (SEED_DEMO=false).",
    );
  if (live && dryRun) problems.push("WHATSAPP_LIVE=true exige DRY_RUN=false.");
  if (live && devAuth)
    problems.push("WHATSAPP_LIVE=true exige autenticação real no painel.");
  if (live) {
    const missing = [
      "META_APP_SECRET",
      "META_VERIFY_TOKEN",
      "META_ACCESS_TOKEN",
      "APPROVAL_CODE_SECRET",
    ].filter((k) => !env[k]);
    if (missing.length)
      problems.push(`Modo real exige as variáveis: ${missing.join(", ")}.`);
  }
  if (problems.length)
    throw new Error(`Configuração insegura recusada: ${problems.join(" ")}`);
  const hours = Number(env.SESSION_HOURS ?? 12);
  return {
    production,
    dryRun,
    devAuth,
    live: live && !dryRun,
    seedDemo,
    signupEnabled:
      overrides.signupEnabled ??
      (env.SIGNUP_ENABLED !== undefined
        ? env.SIGNUP_ENABLED === "true"
        : !production),
    hsts: env.HSTS === "true" || production,
    trustProxy: env.TRUST_PROXY === "true",
    signupRatePerHour: Math.max(1, Number(env.SIGNUP_RATE_PER_HOUR ?? 5) || 5),
    sessionHours:
      Number.isFinite(hours) && hours >= 1 && hours <= 168 ? hours : 12,
  };
}
