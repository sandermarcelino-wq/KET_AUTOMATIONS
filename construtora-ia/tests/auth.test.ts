import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../apps/api/src/app.js";
import type { Session, State } from "../packages/shared/src/index.js";

type Json = Record<string, any>;
const PASS = "Senha-Forte-2026";
describe("Etapa 5: autenticação real, usuários, SaaS e segurança", () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  beforeEach(async () => {
    vi.stubEnv("SIGNUP_RATE_PER_HOUR", "1000");
    app = await createApp({ devAuth: false, signupEnabled: true, seed: false });
  });
  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });
  const call = async (
    path: string,
    token?: string,
    body?: unknown,
    method?: string,
  ) => {
    const r = await app.app.request(path, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: r.status,
      headers: r.headers,
      body: (r.headers.get("content-type")?.includes("json")
        ? await r.json()
        : await r.text()) as Json,
    };
  };
  const signup = async (
    email: string,
    company = "Construtora Teste",
    phone = "+5511988880001",
  ) =>
    await call("/api/auth/signup", undefined, {
      companyName: company,
      ownerName: "Dona Teste",
      email,
      phone,
      password: PASS,
    });
  const login = (email: string, password = PASS) =>
    call("/api/auth/login", undefined, { email, password });

  it("dev login não existe sem DEV_AUTH_ENABLED; saúde informa autenticação por senha", async () => {
    expect(
      (
        await call("/api/dev/login", undefined, {
          tenantId: "x",
          role: "owner",
        })
      ).status,
    ).toBe(401); // rota inexistente: cai na exigência de sessão
    expect((await call("/api/dev/tenants")).status).toBe(401);
    expect((await call("/api/health")).body).toMatchObject({
      authentication: "password",
      signupEnabled: true,
    });
    expect((await call("/api/state")).status).toBe(401);
  });
  it("cadastro da empresa: cria proprietário e sessão; e-mail repetido e senha fraca são recusados", async () => {
    const r = await signup("dona@exemplo.com");
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      role: "owner",
      tenant: { name: "Construtora Teste" },
    });
    const state = (await call("/api/state", r.body.token))
      .body as unknown as State;
    expect(state.worksites).toEqual([]); // empresa nova: sem dados de demonstração
    expect(state.users).toHaveLength(1);
    expect((await signup("DONA@exemplo.com")).status).toBe(409);
    for (const bad of [
      "curta1",
      "somenteletrasaqui",
      "1234567890",
      "dona-exemplo-123",
    ])
      expect(
        (
          await call("/api/auth/signup", undefined, {
            companyName: "X",
            ownerName: "Y",
            email: "x@exemplo.com",
            phone: "+5511977770000",
            password: bad,
          })
        ).status,
        bad,
      ).toBe(400);
    expect(
      (
        await call("/api/auth/signup", undefined, {
          companyName: "X",
          ownerName: "Y",
          email: "x@exemplo.com",
          phone: "11977770000",
          password: PASS,
        })
      ).status,
    ).toBe(400);
  });
  it("login: mesma mensagem para e-mail ou senha errados; senha não fica gravada; token só como hash; logout revoga", async () => {
    await signup("a@exemplo.com");
    const wrong = await login("a@exemplo.com", "Outra-Senha-123");
    const unknown = await login("nao@existe.com");
    expect([wrong.status, unknown.status]).toEqual([401, 401]);
    expect(wrong.body.error).toBe(unknown.body.error);
    const ok = await login("a@exemplo.com");
    expect(ok.status).toBe(200);
    const stored = (
      await app.db.query<{ password_hash: string }>(
        "SELECT password_hash FROM users",
      )
    ).rows[0].password_hash;
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(stored).not.toContain(PASS);
    const sess = (
      await app.db.query<{ token_hash: string }>(
        "SELECT token_hash FROM auth_sessions",
      )
    ).rows.map((x) => x.token_hash);
    expect(sess.every((h) => h !== ok.body.token && h.length === 64)).toBe(
      true,
    );
    expect((await call("/api/auth/me", ok.body.token)).body.role).toBe("owner");
    await call("/api/auth/logout", ok.body.token, {});
    expect((await call("/api/state", ok.body.token)).status).toBe(401);
    // sessão expirada
    const again = await login("a@exemplo.com");
    await app.db.query(
      "UPDATE auth_sessions SET expires_at = now() - interval '1 minute'",
    );
    expect((await call("/api/state", again.body.token)).status).toBe(401);
  });
  it("bloqueio após 5 tentativas inválidas (mesmo com a senha certa) e liberação após o prazo", async () => {
    await signup("b@exemplo.com");
    for (let i = 0; i < 5; i++)
      expect((await login("b@exemplo.com", "Errada-123456")).status).toBe(401);
    const locked = await login("b@exemplo.com");
    expect(locked.status).toBe(401);
    expect(locked.body.error).toContain("bloqueada");
    await app.db.query(
      "UPDATE users SET locked_until = now() - interval '1 minute'",
    );
    expect((await login("b@exemplo.com")).status).toBe(200);
  });
  it("limite de tentativas por e-mail/endereço responde 401 RATE_LIMITED", async () => {
    let last = 0;
    for (let i = 0; i < 12; i++)
      last = (await login("x@exemplo.com", `Tentativa-${i}-abc`)).status;
    expect(last).toBe(401);
    expect((await login("x@exemplo.com")).body.code).toBe("RATE_LIMITED");
  });
  it("cadastro repetido do mesmo endereço é limitado", async () => {
    vi.stubEnv("SIGNUP_RATE_PER_HOUR", "5");
    await app.close();
    app = await createApp({ devAuth: false, signupEnabled: true, seed: false });
    vi.stubEnv("SIGNUP_RATE_PER_HOUR", "5");
    await app.close();
    app = await createApp({ devAuth: false, signupEnabled: true, seed: false });
    let status = 0;
    for (let i = 0; i < 7; i++)
      status = (
        await signup(
          `n${i}@exemplo.com`,
          `Empresa ${i}`,
          `+551198888${String(1000 + i)}`,
        )
      ).status;
    expect(status).toBe(429);
  });
  it("usuários: proprietário cria encarregado com senha provisória; troca obrigatória; outras sessões encerradas; perfil restrito", async () => {
    const owner = (await signup("dono@exemplo.com")).body as Session;
    const w = (
      await call("/api/worksites", owner.token, {
        name: "Obra A",
        address: "Rua 1",
        legalEntityName: "X Ltda",
      })
    ).body;
    await call("/api/worksites", owner.token, {
      name: "Obra B",
      address: "Rua 2",
      legalEntityName: "X Ltda",
    });
    expect(
      (
        await call("/api/users", owner.token, {
          name: "Zé",
          email: "ze@exemplo.com",
          phone: "+5511977770001",
          role: "site_requester",
          worksiteIds: [],
          password: "Provisoria-2026",
        })
      ).status,
    ).toBe(400); // sem obra
    expect(
      (
        await call("/api/users", owner.token, {
          name: "Zé",
          email: "ze@exemplo.com",
          phone: "+5511977770001",
          role: "owner",
          worksiteIds: [w.id],
          password: "Provisoria-2026",
        })
      ).status,
    ).toBe(400); // único proprietário
    expect(
      (
        await call("/api/users", owner.token, {
          name: "Zé",
          email: "ze@exemplo.com",
          phone: "+5511977770001",
          role: "site_requester",
          worksiteIds: [w.id],
          password: "fraca",
        })
      ).status,
    ).toBe(400);
    const created = await call("/api/users", owner.token, {
      name: "Zé",
      email: "ze@exemplo.com",
      phone: "+5511977770001",
      role: "site_requester",
      worksiteIds: [w.id],
      password: "Provisoria-2026",
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      role: "site_requester",
      mustChangePassword: true,
      status: "ACTIVE",
    });
    const ze = (await login("ze@exemplo.com", "Provisoria-2026"))
      .body as Session;
    expect(ze.mustChangePassword).toBe(true);
    const blocked = await call("/api/state", ze.token);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("PASSWORD_CHANGE_REQUIRED");
    expect(
      (
        await call("/api/auth/password", ze.token, {
          current: "Provisoria-2026",
          next: "Provisoria-2026",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("/api/auth/password", ze.token, {
          current: "errada-123456",
          next: "Nova-Senha-2026",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("/api/auth/password", ze.token, {
          current: "Provisoria-2026",
          next: "Nova-Senha-2026",
        })
      ).status,
    ).toBe(200);
    const view = (await call("/api/state", ze.token)).body as unknown as State;
    expect(view.worksites.map((x) => x.name)).toEqual(["Obra A"]); // só a obra autorizada
    expect(view.users).toEqual([]);
    expect(
      (
        await call("/api/users", ze.token, {
          name: "X",
          email: "x@exemplo.com",
          phone: "+5511977770002",
          role: "operator_readonly",
          worksiteIds: [],
          password: PASS,
        })
      ).status,
    ).toBe(403);
    // escritório: leitura
    expect(
      (
        await call("/api/users", owner.token, {
          name: "Ana",
          email: "ana@exemplo.com",
          phone: "+5511977770003",
          role: "operator_readonly",
          worksiteIds: [],
          password: "Provisoria-2026",
        })
      ).status,
    ).toBe(201);
    // reset de senha encerra sessões
    const zeUser = (await call("/api/state", owner.token)).body.users.find(
      (u: Json) => u.email === "ze@exemplo.com",
    );
    const zeSession = (await login("ze@exemplo.com", "Nova-Senha-2026"))
      .body as Session;
    expect(
      (
        await call(`/api/users/${zeUser.id}/reset-password`, owner.token, {
          password: "Reposicao-2026",
        })
      ).status,
    ).toBe(200);
    expect((await call("/api/auth/me", zeSession.token)).status).toBe(401);
    expect((await login("ze@exemplo.com", "Nova-Senha-2026")).status).toBe(401);
    // desativar encerra sessões e impede novo login; o proprietário não pode ser desativado
    const again = (await login("ze@exemplo.com", "Reposicao-2026"))
      .body as Session;
    expect(
      (
        await call(
          `/api/users/${zeUser.id}`,
          owner.token,
          { status: "DISABLED" },
          "PATCH",
        )
      ).body.status,
    ).toBe("DISABLED");
    expect((await call("/api/auth/me", again.token)).status).toBe(401);
    expect((await login("ze@exemplo.com", "Reposicao-2026")).status).toBe(401);
    const ownerRow = (await call("/api/state", owner.token)).body.users.find(
      (u: Json) => u.role === "owner",
    );
    expect(
      (
        await call(
          `/api/users/${ownerRow.id}`,
          owner.token,
          { status: "DISABLED" },
          "PATCH",
        )
      ).status,
    ).toBe(409);
  });
  it("isolamento entre empresas: usuário e obra de uma não são acessíveis pela outra", async () => {
    const a = (await signup("a1@exemplo.com", "Empresa A", "+5511900000001"))
      .body as Session;
    const b = (await signup("b1@exemplo.com", "Empresa B", "+5511900000002"))
      .body as Session;
    const wa = (
      await call("/api/worksites", a.token, {
        name: "Obra A",
        address: "R",
        legalEntityName: "A",
      })
    ).body;
    const sa = (await call("/api/state", a.token)).body as unknown as State;
    const userA = sa.users[0];
    expect(
      (await call(`/api/users/${userA.id}`, b.token, { name: "Hack" }, "PATCH"))
        .status,
    ).toBe(404);
    expect(
      (
        await call(`/api/users/${userA.id}/reset-password`, b.token, {
          password: PASS,
        })
      ).status,
    ).toBe(404);
    expect(
      ((await call("/api/state", b.token)).body as unknown as State).worksites,
    ).toEqual([]);
    expect(
      (await call(`/api/worksites/${wa.id}`, b.token, { name: "x" }, "PATCH"))
        .status,
    ).toBe(404);
  });
  it("planos: limites definidos pelo operador (token); sem token a rota nem existe; uso é medido", async () => {
    const owner = (await signup("p@exemplo.com")).body as Session;
    expect((await call("/api/platform/tenants")).status).toBe(404); // sem PLATFORM_ADMIN_TOKEN
    vi.stubEnv("PLATFORM_ADMIN_TOKEN", "t".repeat(32));
    const adm = (path: string, body?: unknown, token = "t".repeat(32)) =>
      app.app.request(path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "x-platform-admin": token,
          "content-type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    expect(
      (await adm("/api/platform/tenants", undefined, "errado")).status,
    ).toBe(403);
    const tenant = (await call("/api/auth/me", owner.token)).body.tenant;
    const limits = {
      worksites: 1,
      users: 2,
      storageMb: null,
      messagesPerMonth: null,
      aiCallsPerMonth: null,
    };
    expect(
      (
        await adm(`/api/platform/tenants/${tenant.id}/plan`, {
          plan: "BASICO",
          limits,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("/api/worksites", owner.token, {
          name: "O1",
          address: "R",
          legalEntityName: "A",
        })
      ).status,
    ).toBe(201);
    const second = await call("/api/worksites", owner.token, {
      name: "O2",
      address: "R",
      legalEntityName: "A",
    });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("PLAN_LIMIT");
    const w = ((await call("/api/state", owner.token)).body as unknown as State)
      .worksites[0];
    expect(
      (
        await call("/api/users", owner.token, {
          name: "U",
          email: "u@exemplo.com",
          phone: "+5511977771111",
          role: "site_requester",
          worksiteIds: [w.id],
          password: PASS,
        })
      ).status,
    ).toBe(201);
    const over = await call("/api/users", owner.token, {
      name: "V",
      email: "v@exemplo.com",
      phone: "+5511977772222",
      role: "site_requester",
      worksiteIds: [w.id],
      password: PASS,
    });
    expect(over.body.code).toBe("PLAN_LIMIT");
    const info = (
      (await call("/api/state", owner.token)).body as unknown as State
    ).planInfo!;
    expect(info).toMatchObject({
      plan: "BASICO",
      usage: { worksites: 1, users: 2 },
    });
    const listing = await (await adm("/api/platform/tenants")).json();
    expect(listing[0]).toHaveProperty("usage");
  });
  it("cabeçalhos de segurança em todas as respostas; HSTS só em produção", async () => {
    const r = await call("/api/health");
    expect(r.headers.get("content-security-policy")).toContain(
      "default-src 'self'",
    );
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("strict-transport-security")).toBeNull();
    const wh = await app.app.request(
      "/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1",
    );
    expect(wh.headers.get("x-frame-options")).toBe("DENY");
  });
  it("LGPD: exportação dos dados do titular; eliminação só sem contrato (retenção legal)", async () => {
    const owner = (await signup("l@exemplo.com")).body as Session;
    const w = (
      await call("/api/worksites", owner.token, {
        name: "O",
        address: "R",
        legalEntityName: "A",
      })
    ).body;
    const buyer = (
      await call("/api/buyers", owner.token, {
        name: "Fulano",
        document: "529.982.247-25",
        email: "f@exemplo.com",
        legalBasis: "CONSENTIMENTO",
      })
    ).body;
    const exp = (await call(`/api/lgpd/buyers/${buyer.id}/export`, owner.token))
      .body;
    expect(exp.titular).toMatchObject({
      name: "Fulano",
      email: "f@exemplo.com",
    });
    expect(exp.observacao).toContain("retenção");
    expect(
      (
        await call(`/api/lgpd/buyers/${buyer.id}/anonymize`, owner.token, {
          reason: "Pedido do titular",
          confirmed: true,
        })
      ).status,
    ).toBe(200);
    const after = (await call("/api/state", owner.token))
      .body as unknown as State;
    expect(after.buyers[0]).toMatchObject({
      name: "Titular removido (LGPD)",
      email: null,
      phone: null,
    });
    expect(after.buyers[0].document).not.toBe("52998224725");
    // com contrato: retenção
    const unit = (
      await call("/api/units", owner.token, {
        worksiteId: w.id,
        code: "1",
        listPrice: "1000.00",
      })
    ).body;
    const b2 = (
      await call("/api/buyers", owner.token, {
        name: "Beltrano",
        document: "111.444.777-35",
        legalBasis: "EXECUCAO_CONTRATO",
      })
    ).body;
    await call("/api/contracts", owner.token, {
      unitId: unit.id,
      buyerId: b2.id,
      saleDate: "2026-01-10",
      salePrice: "1000.00",
      entryAmount: "0.00",
      entryDueDate: "2026-02-10",
      count: 1,
      firstDueDate: "2026-02-10",
      adjustment: { type: "NONE" },
    });
    const refused = await call(
      `/api/lgpd/buyers/${b2.id}/anonymize`,
      owner.token,
      { reason: "x", confirmed: true },
    );
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("LEGAL_RETENTION");
    // outra empresa e perfis sem permissão
    const other = (await signup("o@exemplo.com", "Outra", "+5511900000009"))
      .body as Session;
    expect(
      (await call(`/api/lgpd/buyers/${b2.id}/export`, other.token)).status,
    ).toBe(404);
  });
});
