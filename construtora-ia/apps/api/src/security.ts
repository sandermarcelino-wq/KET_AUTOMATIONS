import type { Context, MiddlewareHandler } from "hono";

export function securityHeaders(hsts: boolean): MiddlewareHandler {
  return async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "no-referrer");
    c.header(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=()",
    );
    c.header("Cross-Origin-Opener-Policy", "same-origin");
    // O painel é estático e fala só com a própria origem.
    if (!c.res.headers.has("Content-Security-Policy"))
      c.header(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      );
    if (hsts)
      c.header(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains",
      );
  };
}
/** Janela deslizante em memória (por processo). Suficiente para uma instância; use o proxy/WAF para escalar. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private max: number,
    private windowMs: number,
  ) {}
  allow(key: string, at = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter(
      (t) => at - t < this.windowMs,
    );
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(at);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000)
      for (const [k, v] of this.hits)
        if (!v.some((t) => at - t < this.windowMs)) this.hits.delete(k);
    return true;
  }
}
export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const fwd = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (fwd) return fwd;
  }
  const env = c.env as
    { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress ?? "local";
}
