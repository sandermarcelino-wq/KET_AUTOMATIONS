import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../apps/api/src/app.js";
import type {
  Budget,
  MaterialRequest,
  Session,
  State,
  Tenant,
} from "../packages/shared/src/index.js";

describe("API Etapa 0: isolamento, integridade e simulador", () => {
  let instance: Awaited<ReturnType<typeof createApp>>;
  let owner: Session, other: Session, requester: Session, readonly: Session;
  let state: State, otherState: State;
  let directory: string;
  async function call(path: string, session?: Session, body?: unknown) {
    return instance.app.request(path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  async function login(tenantId: string, role: Session["role"]) {
    return (await (
      await call("/api/dev/login", undefined, { tenantId, role })
    ).json()) as Session;
  }
  async function refresh(session: Session) {
    return (await (await call("/api/state", session)).json()) as State;
  }
  const future = () =>
    new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  function requestInput(id = randomUUID()) {
    return {
      providerMessageId: id,
      worksiteId: state.worksites[0].id,
      sender: state.contacts.find((c) => c.role === "site_requester")!.phone,
      text: "Preciso de 100 sacos de cimento CP II 50 kg daqui 3 dias",
      kind: "text",
    };
  }
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "construtora-test-"));
    instance = await createApp({
      dataDir: join(directory, "nested", "database"),
    });
    const tenants = (await (await call("/api/dev/tenants")).json()) as Tenant[];
    owner = await login(tenants[0].id, "owner");
    other = await login(tenants[1].id, "owner");
    requester = await login(owner.tenant.id, "site_requester");
    readonly = await login(owner.tenant.id, "operator_readonly");
    state = await refresh(owner);
    otherState = await refresh(other);
  });
  afterAll(async () => {
    await instance?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("não expõe dados privados sem sessão", async () => {
    expect((await call("/api/state")).status).toBe(401);
    const health = await (await call("/api/health")).json();
    expect(health.dryRun).toBe(true);
    expect((await call("/api/purchases", owner, {})).status).toBe(404);
  });
  it("nega IDs de outro tenant no orçamento e exportação", async () => {
    const foreign = otherState.budgets[0];
    expect(
      (await call(`/api/budgets/${foreign.id}/export`, owner)).status,
    ).toBe(404);
    expect(
      (await call(`/api/budgets/${foreign.id}/freeze`, owner, {})).status,
    ).toBe(404);
    expect(
      (
        await call("/api/budgets", owner, {
          worksiteId: otherState.worksites[0].id,
          items: [
            {
              materialId: state.materials[0].id,
              quantity: "1",
              unitPrice: "1.00",
            },
          ],
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call("/api/budgets", owner, {
          worksiteId: state.worksites[0].id,
          items: [
            {
              materialId: otherState.materials[0].id,
              quantity: "1",
              unitPrice: "1.00",
            },
          ],
        })
      ).status,
    ).toBe(404);
  });
  it("RLS bloqueia SELECT e INSERT cross-tenant mesmo por SQL", async () => {
    await instance.db.transaction(async (tx) => {
      await tx.exec("SET LOCAL ROLE construtora_app");
      await tx.query("SELECT set_config('app.tenant_id',$1,true)", [
        owner.tenant.id,
      ]);
      const rows = await tx.query(
        "SELECT id FROM worksites WHERE tenant_id=$1",
        [other.tenant.id],
      );
      expect(rows.rows).toHaveLength(0);
    });
    await expect(
      instance.db.transaction(async (tx) => {
        await tx.exec("SET LOCAL ROLE construtora_app");
        await tx.query("SELECT set_config('app.tenant_id',$1,true)", [
          owner.tenant.id,
        ]);
        const id = randomUUID();
        await tx.query(
          "INSERT INTO worksites(id,tenant_id,data) VALUES($1,$2,$3)",
          [id, other.tenant.id, JSON.stringify({ id, name: "invasão" })],
        );
      }),
    ).rejects.toThrow();
  });
  it("escritório não altera cadastros e pedreiro não acessa orçamento/lojas", async () => {
    expect(
      (
        await call("/api/worksites", readonly, {
          name: "Outra obra",
          address: "Rua teste",
          legalEntityName: "Empresa teste",
        })
      ).status,
    ).toBe(403);
    expect(
      (await call("/api/simulator/messages", readonly, requestInput())).status,
    ).toBe(403);
    const restricted = await refresh(requester);
    expect(restricted.budgets).toEqual([]);
    expect(restricted.suppliers).toEqual([]);
    expect(restricted.audit).toEqual([]);
    expect(restricted.contacts).toHaveLength(1);
    expect(
      (await call(`/api/budgets/${state.budgets[0].id}/export`, requester))
        .status,
    ).toBe(403);
  });
  it("valida cadastros e não aceita tenantId fornecido no corpo", async () => {
    expect(
      (
        await call("/api/suppliers", owner, {
          name: "Loja nova",
          phone: "119999",
          categories: ["Estrutura"],
          leadDays: 2,
          consent: true,
          active: true,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("/api/worksites", owner, {
          tenantId: other.tenant.id,
          name: "Outra obra",
          address: "Rua teste",
          legalEntityName: "Empresa teste",
        })
      ).status,
    ).toBe(400);
    for (let i = 0; i < 2; i++)
      expect(
        (
          await call("/api/suppliers", owner, {
            name: `Fornecedor teste ${i}`,
            phone: `+551198765000${i}`,
            categories: ["Categoria teste"],
            leadDays: 2,
            consent: true,
            active: true,
          })
        ).status,
      ).toBe(201);
  });
  it("deduplica cinco entregas concorrentes do mesmo evento e rejeita conteúdo alterado", async () => {
    const body = requestInput();
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        call("/api/simulator/messages", owner, body),
      ),
    );
    const results = await Promise.all(responses.map((r) => r.json()));
    expect(responses.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(new Set(results.map((r) => r.request.id)).size).toBe(1);
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(results[0].request.status).toBe("READY_TO_QUOTE");
    expect(
      (
        await call("/api/simulator/messages", owner, {
          ...body,
          text: "Texto alterado",
        })
      ).status,
    ).toBe(409);
  });
  it("não interpreta pedido incompleto como compra; permite esclarecimento explícito", async () => {
    const response = await call("/api/simulator/messages", owner, {
      ...requestInput(),
      text: "10 tubos 25",
    });
    const { request } = (await response.json()) as { request: MaterialRequest };
    expect(request.status).toBe("NEEDS_CLARIFICATION");
    expect(request.clarification).toBeTruthy();
    expect(
      (await call(`/api/requests/${request.id}/quote`, owner, {})).status,
    ).toBe(409);
    const clarified = await call(`/api/requests/${request.id}/clarify`, owner, {
      materialId: state.materials[0].id,
      quantity: "10",
      requiredDate: future(),
    });
    expect(clarified.status).toBe(200);
    expect((await clarified.json()).status).toBe("READY_TO_QUOTE");
    expect(
      (
        await call(`/api/requests/${request.id}/clarify`, owner, {
          materialId: state.materials[0].id,
          quantity: "20",
          requiredDate: future(),
        })
      ).status,
    ).toBe(409);
  });
  it("gera RFQs simuladas apenas uma vez e limita mensagens visíveis do pedreiro", async () => {
    const body = requestInput();
    const { request } = (await (
      await call("/api/simulator/messages", requester, body)
    ).json()) as { request: MaterialRequest };
    const first = await (
      await call(`/api/requests/${request.id}/quote`, requester, {})
    ).json();
    const repeated = await (
      await call(`/api/requests/${request.id}/quote`, requester, {})
    ).json();
    expect(first.request.status).toBe("QUOTING");
    expect(first.invitations).toBeGreaterThanOrEqual(2);
    expect(repeated.duplicate).toBe(true);
    const after = await refresh(owner);
    const sent = after.messages.filter(
      (m) => m.requestId === request.id && m.text.includes("Cotação"),
    );
    expect(sent).toHaveLength(first.invitations);
    expect(sent.every((m) => m.status === "SENT_SIMULATED")).toBe(true);
    const restricted = await refresh(requester);
    expect(restricted.messages.every((m) => m.recipient === body.sender)).toBe(
      true,
    );
    expect(
      (await call(`/api/requests/${request.id}/quote`, other, {})).status,
    ).toBe(404);
    const forged = {
      ...requestInput(),
      sender: state.contacts.find((c) => c.role === "owner")!.phone,
    };
    expect(
      (await call("/api/simulator/messages", requester, forged)).status,
    ).toBe(403);
  });
  it("preserva orçamento congelado e trilha de auditoria no banco", async () => {
    const base = state.budgets.find((b) => b.status === "FROZEN")!;
    await expect(
      instance.db.query(
        "UPDATE budgets SET data=jsonb_set(data,'{total}','\"0.00\"') WHERE id=$1",
        [base.id],
      ),
    ).rejects.toThrow();
    await expect(
      instance.db.query("DELETE FROM budgets WHERE id=$1", [base.id]),
    ).rejects.toThrow();
    const events = await instance.db.query<{ id: string }>(
      "SELECT id FROM audit_events LIMIT 1",
    );
    expect(events.rows.length).toBe(1);
    await expect(
      instance.db.query("DELETE FROM audit_events WHERE id=$1", [
        events.rows[0].id,
      ]),
    ).rejects.toThrow();
    const response = await call("/api/budgets", owner, {
      worksiteId: state.worksites[0].id,
      items: [
        { materialId: state.materials[0].id, quantity: "3", unitPrice: "0.10" },
      ],
    });
    expect(response.status).toBe(201);
    const draft = (await response.json()) as Budget;
    expect(draft.total).toBe("0.30");
    expect(draft.version).toBeGreaterThan(base.version);
    expect(
      (await call(`/api/budgets/${draft.id}/freeze`, owner, {})).status,
    ).toBe(200);
    expect(
      (await refresh(owner)).budgets.find((b) => b.id === base.id),
    ).toEqual(base);
  });
  it("revalida importação, impede unidade incompatível e não duplica confirmação", async () => {
    const m = state.materials[0];
    const csv = `material;unidade;quantidade;preco_unitario\n${m.name};${m.unit};2;30,00`;
    const body = { worksiteId: state.worksites[0].id, csv };
    const preview = await (
      await call("/api/imports/preview", owner, body)
    ).json();
    expect(preview.valid).toBe(true);
    expect(preview.total).toBe("60.00");
    expect(
      (await call("/api/imports/commit", owner, { ...body, confirmed: false }))
        .status,
    ).toBe(400);
    const first = await (
      await call("/api/imports/commit", owner, { ...body, confirmed: true })
    ).json();
    const again = await (
      await call("/api/imports/commit", owner, { ...body, confirmed: true })
    ).json();
    expect(again.id).toBe(first.id);
    const bad = {
      worksiteId: state.worksites[0].id,
      csv: `material;unidade;quantidade;preco_unitario\n${m.name};unidade errada;2;30,00`,
    };
    expect(
      (await (await call("/api/imports/preview", owner, bad)).json()).valid,
    ).toBe(false);
    expect(
      (await call("/api/imports/commit", owner, { ...bad, confirmed: true }))
        .status,
    ).toBe(400);
  });
  it("rejeita soma acima do limite sem erro interno", async () => {
    const rows = state.materials.slice(0, 2).map((m) => ({
      materialId: m.id,
      quantity: "999999999999",
      unitPrice: "10000",
    }));
    const response = await call("/api/budgets", owner, {
      worksiteId: state.worksites[0].id,
      items: rows,
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("limite");
    const csv =
      "material;unidade;quantidade;preco_unitario\n" +
      state.materials
        .slice(0, 2)
        .map((m) => `${m.name};${m.unit};999999999999;10000`)
        .join("\n");
    const preview = await (
      await call("/api/imports/preview", owner, {
        worksiteId: state.worksites[0].id,
        csv,
      })
    ).json();
    expect(preview.valid).toBe(false);
    expect(preview.errors[0].message).toContain("limite");
  });
  it("mantém histórico e deduplicação após reiniciar o PostgreSQL local", async () => {
    const body = { ...requestInput(), kind: "audio_transcript" };
    const first = await (
      await call("/api/simulator/messages", owner, body)
    ).json();
    await instance.close();
    instance = await createApp({
      dataDir: join(directory, "nested", "database"),
    });
    owner = await login(owner.tenant.id, "owner");
    const again = await (
      await call("/api/simulator/messages", owner, body)
    ).json();
    expect(again.duplicate).toBe(true);
    expect(again.request.id).toBe(first.request.id);
    expect((await refresh(owner)).suppliers.length).toBe(
      state.suppliers.length + 2,
    );
  });
});
