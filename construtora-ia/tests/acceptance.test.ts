import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../apps/api/src/app.js";
import { extractRequest } from "../packages/domain/src/index.js";
import type {
  Material,
  MaterialRequest,
  Session,
  State,
  Tenant,
  Worksite,
} from "../packages/shared/src/index.js";
const catalog: Material[] = [
  {
    id: "gravel",
    name: "Brita 1",
    unit: "m³",
    category: "Agregados",
    aliases: [],
  },
  {
    id: "cement",
    name: "Cimento CP II 50 kg",
    unit: "saco 50 kg",
    category: "Cimentos",
    aliases: [],
  },
  {
    id: "wire",
    name: "Fio de cobre 2,5 mm²",
    unit: "m",
    category: "Elétrica",
    aliases: [],
  },
];
describe("aceite: correspondência conservadora de especificações", () => {
  it.each(["100 m³ de brita 10 amanhã", "100 m³ de brita 1A amanhã"])(
    "não considera prefixo de outro produto equivalente: %s",
    (text) => {
      const result = extractRequest(
        text,
        catalog,
        new Date("2026-11-18T12:00:00Z"),
      );
      expect(result.materialId).toBeNull();
      expect(result.clarification).toBeTruthy();
    },
  );
  it.each([" e ", ", ", "\n"])(
    "não descarta um segundo item desconhecido separado por %s",
    (separator) => {
      const result = extractRequest(
        `100 sacos de cimento CP II 50 kg${separator}10 tubos especiais amanhã`,
        catalog,
        new Date("2026-11-18T12:00:00Z"),
      );
      expect(result.clarification).toBeTruthy();
      expect(result.materialId).toBeNull();
    },
  );
  it("aceita seção de fio com unidade quadrada sem truncar especificação", () => {
    const result = extractRequest(
      "100 m de fio de cobre 2,5 mm² daqui dois dias",
      catalog,
      new Date("2026-11-18T12:00:00Z"),
    );
    expect(result).toMatchObject({
      materialId: "wire",
      quantity: "100",
      requiredDate: "2026-11-20",
      clarification: null,
    });
  });
});

describe("aceite: isolamento de obra e recuperação após reinício", () => {
  let runtime: Awaited<ReturnType<typeof createApp>>;
  let directory: string;
  let owner: Session;
  let state: State;
  async function call(path: string, token: string, body?: unknown) {
    return runtime.app.request(path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function login(
    role: "owner" | "site_requester",
    tenantId: string,
  ): Promise<Session> {
    const response = await runtime.app.request("/api/dev/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId, role }),
    });
    expect(response.status).toBe(200);
    return response.json() as Promise<Session>;
  }
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "construtora-acceptance-"));
    runtime = await createApp({ dataDir: directory });
    const tenants = (await (
      await runtime.app.request("/api/dev/tenants")
    ).json()) as Tenant[];
    owner = await login(
      "owner",
      tenants.find((t) => t.name.includes("Horizonte"))!.id,
    );
    state = (await (await call("/api/state", owner.token)).json()) as State;
  });
  afterAll(async () => {
    await runtime?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  it("um solicitante não ganha acesso a uma nova obra da mesma empresa", async () => {
    const response = await call("/api/worksites", owner.token, {
      name: "Obra restrita",
      address: "Endereço fictício",
      legalEntityName: "Entidade de teste",
    });
    expect(response.status).toBe(201);
    const worksite = (await response.json()) as Worksite;
    const requester = await login("site_requester", owner.tenant.id);
    const requesterState = (await (
      await call("/api/state", requester.token)
    ).json()) as State;
    expect(requesterState.worksites.some((w) => w.id === worksite.id)).toBe(
      false,
    );
    const denied = await call("/api/simulator/messages", requester.token, {
      providerMessageId: "forbidden-new-worksite",
      worksiteId: worksite.id,
      sender: requesterState.contacts[0].phone,
      text: "100 sacos de cimento CP II 50 kg amanhã",
      kind: "text",
    });
    expect(denied.status).toBe(404);
  });
  it("preserva deduplicação de mensagem e convites ao reabrir o banco", async () => {
    const input = {
      providerMessageId: "persistent-webhook-id",
      worksiteId: state.worksites[0].id,
      sender: state.contacts.find((c) => c.role === "site_requester")!.phone,
      text: "100 sacos de cimento CP II 50 kg daqui dois dias",
      kind: "audio_transcript",
    };
    const first = await call("/api/simulator/messages", owner.token, input);
    expect(first.status).toBe(201);
    const received = (await first.json()) as {
      request: MaterialRequest;
      duplicate: boolean;
    };
    expect(received.request.status).toBe("READY_TO_QUOTE");
    const quote = await call(
      `/api/requests/${received.request.id}/quote`,
      owner.token,
      {},
    );
    expect(quote.status).toBe(200);
    const before = (await (
      await call("/api/state", owner.token)
    ).json()) as State;
    const originalToken = owner.token;
    await runtime.close();
    runtime = await createApp({ dataDir: directory });
    expect((await call("/api/state", originalToken)).status).toBe(401);
    owner = await login("owner", owner.tenant.id);
    const replay = await call("/api/simulator/messages", owner.token, input);
    expect(replay.status).toBe(201);
    expect(await replay.json()).toMatchObject({
      duplicate: true,
      request: { id: received.request.id, status: "QUOTING" },
    });
    const repeatedQuote = await call(
      `/api/requests/${received.request.id}/quote`,
      owner.token,
      {},
    );
    expect(await repeatedQuote.json()).toMatchObject({ duplicate: true });
    const changed = await call("/api/simulator/messages", owner.token, {
      ...input,
      text: "200 sacos de cimento CP II 50 kg daqui dois dias",
    });
    expect(changed.status).toBe(409);
    const after = (await (
      await call("/api/state", owner.token)
    ).json()) as State;
    expect(after.requests.length).toBe(before.requests.length);
    expect(after.messages.length).toBe(before.messages.length);
    expect(after.audit.length).toBe(before.audit.length);
  });
});
