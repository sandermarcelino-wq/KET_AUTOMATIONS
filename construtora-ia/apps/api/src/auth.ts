import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCb,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type { Hono } from "hono";
import { z } from "zod";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import type {
  AppUser,
  Contact,
  PlanInfo,
  Role,
  Tenant,
} from "../../../packages/shared/src/index.js";
import {
  ApiError,
  assertOwner,
  audit,
  get,
  list,
  now,
  text,
  uuid,
  type Env,
  type UserSession,
} from "./common.js";
import type { RuntimeConfig } from "./config.js";
import { RateLimiter, clientIp } from "./security.js";
import { planInfo } from "./services.js";

const scrypt = promisify(scryptCb) as (
  pw: string,
  salt: Buffer,
  len: number,
  opts: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;
const N = 32768;
const COMMON = new Set([
  "123456789012",
  "1234567890",
  "password123",
  "senha12345",
  "senha123456",
  "qwertyuiop",
  "construtora",
  "12345678910",
  "admin12345",
  "abcdefghij",
]);
export function passwordProblem(pw: string, email?: string): string | null {
  if (pw.length < 10) return "A senha deve ter ao menos 10 caracteres.";
  if (pw.length > 200) return "Senha longa demais.";
  if (COMMON.has(pw.toLowerCase()) || /^(.)\1+$/.test(pw))
    return "Senha muito comum.";
  if (
    email &&
    pw.toLowerCase().includes(email.split("@")[0].toLowerCase()) &&
    email.split("@")[0].length >= 4
  )
    return "A senha não pode conter o seu e-mail.";
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw))
    return "Use letras e números na senha.";
  return null;
}
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 32, {
    N,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${N}$8$1$${salt.toString("base64")}$${key.toString("base64")}`;
}
export async function verifyPassword(
  pw: string,
  stored: string,
): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt") return false;
  const key = await scrypt(pw, Buffer.from(salt, "base64"), 32, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  });
  const expected = Buffer.from(hash, "base64");
  return key.length === expected.length && timingSafeEqual(key, expected);
}
const DUMMY = hashPassword("senha-inexistente-para-tempo-constante");
const tokenHash = (t: string) => createHash("sha256").update(t).digest("hex");
const normEmail = (e: string) => e.trim().toLowerCase();

export interface AuthDeps {
  db: PGlite;
  cfg: RuntimeConfig;
  scoped: <T>(
    s: UserSession,
    fn: (tx: Transaction) => Promise<T>,
  ) => Promise<T>;
}
/** Sessão persistida (sobrevive a reinício, revogável). Retorna null se inválida/expirada/desativada. */
export async function loadDbSession(
  db: PGlite,
  token: string,
): Promise<UserSession | null> {
  const row = (
    await db.query<{
      expires_at: string;
      user_id: string;
      status: string;
      must: boolean;
      tenant_id: string;
      tname: string;
      contact: Contact;
    }>(
      `SELECT a.expires_at::text AS expires_at, u.id AS user_id, u.status, u.must_change_password AS must, u.tenant_id, t.name AS tname, c.data AS contact
       FROM auth_sessions a JOIN users u ON u.id=a.user_id JOIN tenants t ON t.id=u.tenant_id JOIN contacts c ON c.tenant_id=u.tenant_id AND c.id=u.contact_id
       WHERE a.token_hash=$1`,
      [tokenHash(token)],
    )
  ).rows[0];
  if (
    !row ||
    row.status !== "ACTIVE" ||
    Date.parse(row.expires_at) < Date.now()
  )
    return null;
  return {
    token,
    tenant: { id: row.tenant_id, name: row.tname },
    role: row.contact.role,
    userName: row.contact.name,
    contactId: row.contact.id,
    expiresAt: Date.parse(row.expires_at),
    userId: row.user_id,
    mustChangePassword: row.must,
  };
}
async function createDbSession(
  db: PGlite,
  cfg: RuntimeConfig,
  user: { id: string; tenant_id: string },
  ua: string | undefined,
) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + cfg.sessionHours * 3600000);
  await db.query(
    "INSERT INTO auth_sessions(id,tenant_id,user_id,token_hash,expires_at,user_agent) VALUES($1,$2,$3,$4,$5,$6)",
    [
      randomUUID(),
      user.tenant_id,
      user.id,
      tokenHash(token),
      expires.toISOString(),
      ua?.slice(0, 200) ?? null,
    ],
  );
  await db.query(
    "DELETE FROM auth_sessions WHERE user_id=$1 AND expires_at < now()",
    [user.id],
  );
  return token;
}
const emailSchema = z.string().trim().toLowerCase().email().max(120);
const phoneSchema = z
  .string()
  .regex(
    /^\+[1-9]\d{7,14}$/,
    "Informe telefone E.164, por exemplo +5511999990000.",
  );

/** Cria empresa + proprietário + usuário (auto-cadastro SaaS ou bootstrap de implantação). */
export async function createTenantWithOwner(
  db: PGlite,
  input: {
    companyName: string;
    ownerName: string;
    email: string;
    phone: string;
    password: string;
    mustChange?: boolean;
  },
) {
  const problem = passwordProblem(input.password, input.email);
  if (problem) throw new ApiError(400, problem);
  const hash = await hashPassword(input.password);
  const tenant: Tenant = { id: randomUUID(), name: input.companyName };
  const contact: Contact = {
    id: randomUUID(),
    name: input.ownerName,
    phone: input.phone,
    role: "owner",
    worksiteIds: [],
  };
  const userId = randomUUID();
  await db.transaction(async (tx) => {
    await tx.query("INSERT INTO tenants(id,name) VALUES($1,$2)", [
      tenant.id,
      tenant.name,
    ]);
    await tx.query("INSERT INTO contacts(id,tenant_id,data) VALUES($1,$2,$3)", [
      contact.id,
      tenant.id,
      JSON.stringify(contact),
    ]);
    await tx.query(
      "INSERT INTO users(id,tenant_id,contact_id,email,password_hash,must_change_password) VALUES($1,$2,$3,$4,$5,$6)",
      [
        userId,
        tenant.id,
        contact.id,
        normEmail(input.email),
        hash,
        input.mustChange ?? false,
      ],
    );
    await tx.query("INSERT INTO tenant_plans(tenant_id,data) VALUES($1,$2)", [
      tenant.id,
      JSON.stringify({
        plan: "TRIAL",
        limits: {
          worksites: null,
          users: null,
          storageMb: null,
          messagesPerMonth: null,
          aiCallsPerMonth: null,
        },
      }),
    ]);
    const auditId = randomUUID();
    await tx.query(
      "INSERT INTO audit_events(id,tenant_id,data) VALUES($1,$2,$3)",
      [
        auditId,
        tenant.id,
        JSON.stringify({
          id: auditId,
          action: "TENANT_CREATED",
          entityId: tenant.id,
          actor: "Cadastro da empresa",
          createdAt: now(),
        }),
      ],
    );
  });
  return { tenant, contact, userId };
}

export function registerAuth(
  app: Hono<Env>,
  { db, cfg, scoped }: AuthDeps,
  phase: "public" | "private",
) {
  const loginIp = new RateLimiter(30, 15 * 60_000);
  const loginEmail = new RateLimiter(10, 15 * 60_000);
  const signupIp = new RateLimiter(cfg.signupRatePerHour, 3600_000);
  const publicSession = (
    s: { token: string; tenant: Tenant; role: Role; userName: string },
    must: boolean,
  ) => ({
    token: s.token,
    tenant: s.tenant,
    role: s.role,
    userName: s.userName,
    mustChangePassword: must,
  });

  if (phase === "public") {
    if (cfg.signupEnabled)
      app.post("/api/auth/signup", async (c) => {
        if (!signupIp.allow(clientIp(c, cfg.trustProxy)))
          throw new ApiError(
            429,
            "Muitos cadastros deste endereço. Tente mais tarde.",
          );
        const body = z
          .object({
            companyName: text,
            ownerName: text,
            email: emailSchema,
            phone: phoneSchema,
            password: z.string().min(1).max(200),
          })
          .strict()
          .parse(await c.req.json());
        try {
          const { tenant, userId } = await createTenantWithOwner(db, body);
          const token = await createDbSession(
            db,
            cfg,
            { id: userId, tenant_id: tenant.id },
            c.req.header("user-agent"),
          );
          const s = (await loadDbSession(db, token))!;
          return c.json(publicSession(s, false), 201);
        } catch (e) {
          if ((e as { code?: string }).code === "23505")
            throw new ApiError(409, "Este e-mail já está cadastrado.");
          throw e;
        }
      });

    app.post("/api/auth/login", async (c) => {
      const body = z
        .object({ email: emailSchema, password: z.string().min(1).max(200) })
        .strict()
        .parse(await c.req.json());
      if (
        !loginIp.allow(clientIp(c, cfg.trustProxy)) ||
        !loginEmail.allow(body.email)
      )
        throw new ApiError(
          401,
          "Muitas tentativas. Aguarde alguns minutos.",
          "RATE_LIMITED",
        );
      const user = (
        await db.query<{
          id: string;
          tenant_id: string;
          password_hash: string;
          status: string;
          must: boolean;
          failed: number;
          locked: string | null;
        }>(
          "SELECT id, tenant_id, password_hash, status, must_change_password AS must, failed_attempts AS failed, locked_until::text AS locked FROM users WHERE email=$1",
          [body.email],
        )
      ).rows[0];
      const ok = await verifyPassword(
        body.password,
        user?.password_hash ?? (await DUMMY),
      );
      const locked = !!user?.locked && Date.parse(user.locked) > Date.now();
      if (!user || !ok || user.status !== "ACTIVE" || locked) {
        if (user && !locked && user.status === "ACTIVE")
          await db.query(
            "UPDATE users SET failed_attempts = failed_attempts + 1, locked_until = CASE WHEN failed_attempts + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END WHERE id=$1",
            [user.id],
          );
        throw new ApiError(
          401,
          locked
            ? "Conta temporariamente bloqueada por tentativas inválidas. Tente em 15 minutos."
            : "E-mail ou senha inválidos.",
          "INVALID_CREDENTIALS",
        );
      }
      await db.query(
        "UPDATE users SET failed_attempts=0, locked_until=NULL, last_login_at=now() WHERE id=$1",
        [user.id],
      );
      const token = await createDbSession(
        db,
        cfg,
        user,
        c.req.header("user-agent"),
      );
      const s = (await loadDbSession(db, token))!;
      return c.json(publicSession(s, s.mustChangePassword ?? false));
    });
  }
  if (phase === "public") return;
  app.post("/api/auth/logout", async (c) => {
    const s = c.get("session");
    if (s.userId)
      await db.query("DELETE FROM auth_sessions WHERE token_hash=$1", [
        tokenHash(s.token),
      ]);
    return c.json({ ok: true });
  });
  app.get("/api/auth/me", (c) => {
    const s = c.get("session");
    return c.json(publicSession(s, s.mustChangePassword ?? false));
  });
  app.post("/api/auth/password", async (c) => {
    const s = c.get("session");
    if (!s.userId)
      throw new ApiError(400, "Sessão de demonstração não tem senha.");
    const body = z
      .object({
        current: z.string().min(1).max(200),
        next: z.string().min(1).max(200),
      })
      .strict()
      .parse(await c.req.json());
    const user = (
      await db.query<{ password_hash: string; email: string }>(
        "SELECT password_hash, email FROM users WHERE id=$1",
        [s.userId],
      )
    ).rows[0];
    if (!(await verifyPassword(body.current, user.password_hash)))
      throw new ApiError(400, "Senha atual incorreta.");
    const problem = passwordProblem(body.next, user.email);
    if (problem) throw new ApiError(400, problem);
    if (body.next === body.current)
      throw new ApiError(400, "A nova senha deve ser diferente da atual.");
    await db.query(
      "UPDATE users SET password_hash=$1, must_change_password=false, failed_attempts=0 WHERE id=$2",
      [await hashPassword(body.next), s.userId],
    );
    await db.query(
      "DELETE FROM auth_sessions WHERE user_id=$1 AND token_hash <> $2",
      [s.userId, tokenHash(s.token)],
    ); // encerra as outras sessões
    return c.json({ ok: true });
  });

  // ---- usuários da empresa (somente proprietário). Exatamente um proprietário aprova compras.
  const userRows = async (
    tx: Transaction,
    tenantId: string,
  ): Promise<AppUser[]> => {
    const [users, contacts] = await Promise.all([
      tx.query<{
        id: string;
        contact_id: string;
        email: string;
        status: "ACTIVE" | "DISABLED";
        must: boolean;
        last: string | null;
      }>(
        "SELECT id, contact_id, email, status, must_change_password AS must, last_login_at::text AS last FROM users WHERE tenant_id=$1 ORDER BY email",
        [tenantId],
      ),
      list<Contact>(tx, "contacts", tenantId),
    ]);
    return users.rows.flatMap((u) => {
      const c = contacts.find((x) => x.id === u.contact_id);
      return c
        ? [
            {
              id: u.id,
              name: c.name,
              email: u.email,
              phone: c.phone,
              role: c.role,
              status: u.status,
              mustChangePassword: u.must,
              worksiteIds: c.worksiteIds,
              lastLoginAt: u.last,
            },
          ]
        : [];
    });
  };
  const newUser = z
    .object({
      name: text,
      email: emailSchema,
      phone: phoneSchema,
      role: z.enum(["site_requester", "operator_readonly"]),
      worksiteIds: z.array(uuid).max(100),
      password: z.string().min(1).max(200),
    })
    .strict();
  app.post("/api/users", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = newUser.parse(await c.req.json());
    if (body.role === "site_requester" && !body.worksiteIds.length)
      throw new ApiError(400, "Informe ao menos uma obra para o encarregado.");
    const problem = passwordProblem(body.password, body.email);
    if (problem) throw new ApiError(400, problem);
    const hash = await hashPassword(body.password);
    return c.json(
      await scoped(s, async (tx) => {
        const info = await planInfo(tx, s.tenant.id);
        if (info.limits.users !== null && info.usage.users >= info.limits.users)
          throw new ApiError(
            409,
            `Limite de usuários do plano atingido (${info.limits.users}).`,
            "PLAN_LIMIT",
          );
        const contact: Contact = {
          id: randomUUID(),
          name: body.name,
          phone: body.phone,
          role: body.role,
          worksiteIds: body.worksiteIds,
        };
        await tx.query(
          "INSERT INTO contacts(id,tenant_id,data) VALUES($1,$2,$3)",
          [contact.id, s.tenant.id, JSON.stringify(contact)],
        );
        const id = randomUUID();
        await tx.query(
          "INSERT INTO users(id,tenant_id,contact_id,email,password_hash,must_change_password) VALUES($1,$2,$3,$4,$5,true)",
          [id, s.tenant.id, contact.id, body.email, hash],
        );
        await audit(tx, s, "USER_CREATED", id);
        return (await userRows(tx, s.tenant.id)).find((u) => u.id === id)!;
      }),
      201,
    );
  });
  app.patch("/api/users/:id", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = z
      .object({
        name: text,
        status: z.enum(["ACTIVE", "DISABLED"]),
        worksiteIds: z.array(uuid).max(100),
      })
      .partial()
      .strict()
      .parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const u = (
          await tx.query<{ id: string; contact_id: string }>(
            "SELECT id, contact_id FROM users WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [s.tenant.id, c.req.param("id")],
          )
        ).rows[0];
        if (!u) throw new ApiError(404, "Usuário não encontrado.");
        const contact = await get<Contact>(
          tx,
          "contacts",
          s.tenant.id,
          u.contact_id,
          true,
        );
        if (
          contact.role === "owner" &&
          (body.status === "DISABLED" || body.worksiteIds)
        )
          throw new ApiError(
            409,
            "O proprietário não pode ser desativado nem ter obras restringidas.",
          );
        if (body.name || body.worksiteIds)
          await tx.query(
            "UPDATE contacts SET data=$1 WHERE tenant_id=$2 AND id=$3",
            [
              JSON.stringify({
                ...contact,
                ...(body.name ? { name: body.name } : {}),
                ...(body.worksiteIds ? { worksiteIds: body.worksiteIds } : {}),
              }),
              s.tenant.id,
              contact.id,
            ],
          );
        if (body.status)
          await tx.query(
            "UPDATE users SET status=$1 WHERE tenant_id=$2 AND id=$3",
            [body.status, s.tenant.id, u.id],
          );
        if (body.status === "DISABLED")
          await tx.query("DELETE FROM auth_sessions WHERE user_id=$1", [u.id]);
        await audit(tx, s, "USER_UPDATED", u.id);
        return (await userRows(tx, s.tenant.id)).find((x) => x.id === u.id)!;
      }),
    );
  });
  app.post("/api/users/:id/reset-password", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = z
      .object({ password: z.string().min(1).max(200) })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const u = (
          await tx.query<{ id: string; email: string; contact_id: string }>(
            "SELECT id, email, contact_id FROM users WHERE tenant_id=$1 AND id=$2",
            [s.tenant.id, c.req.param("id")],
          )
        ).rows[0];
        if (!u) throw new ApiError(404, "Usuário não encontrado.");
        if (u.id === s.userId)
          throw new ApiError(
            409,
            "Use “Alterar minha senha” para a própria conta.",
          );
        const problem = passwordProblem(body.password, u.email);
        if (problem) throw new ApiError(400, problem);
        await tx.query(
          "UPDATE users SET password_hash=$1, must_change_password=true, failed_attempts=0, locked_until=NULL WHERE id=$2",
          [await hashPassword(body.password), u.id],
        );
        await tx.query("DELETE FROM auth_sessions WHERE user_id=$1", [u.id]);
        await audit(tx, s, "USER_PASSWORD_RESET", u.id);
        return { ok: true };
      }),
    );
  });
}
export async function authState(
  tx: Transaction,
  s: UserSession,
): Promise<{ users: AppUser[]; planInfo: PlanInfo | null }> {
  if (s.role !== "owner") return { users: [], planInfo: null };
  const [users, contacts] = await Promise.all([
    tx.query<{
      id: string;
      contact_id: string;
      email: string;
      status: "ACTIVE" | "DISABLED";
      must: boolean;
      last: string | null;
    }>(
      "SELECT id, contact_id, email, status, must_change_password AS must, last_login_at::text AS last FROM users WHERE tenant_id=$1 ORDER BY email",
      [s.tenant.id],
    ),
    list<Contact>(tx, "contacts", s.tenant.id),
  ]);
  return {
    users: users.rows.flatMap((u) => {
      const c = contacts.find((x) => x.id === u.contact_id);
      return c
        ? [
            {
              id: u.id,
              name: c.name,
              email: u.email,
              phone: c.phone,
              role: c.role,
              status: u.status,
              mustChangePassword: u.must,
              worksiteIds: c.worksiteIds,
              lastLoginAt: u.last,
            },
          ]
        : [];
    }),
    planInfo: await planInfo(tx, s.tenant.id),
  };
}
