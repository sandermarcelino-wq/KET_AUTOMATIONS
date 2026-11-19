import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  extractRequest,
  matchWorker,
  parseLaborPayments,
  parseOwnerCommand,
} from "../packages/domain/src/index.js";
import type { AIProvider } from "../packages/integrations/src/index.js";
import type { Material, Worker } from "../packages/shared/src/index.js";
import { setup, PNG } from "./helpers.js";

type Ctx = Awaited<ReturnType<typeof setup>>;
const now = new Date("2026-11-19T12:00:00Z");
const mat = (
  name: string,
  unit: string,
  quickNames: string[] = [],
): Material => ({
  id: crypto.randomUUID(),
  name,
  unit,
  category: "x",
  aliases: [name.toLowerCase()],
  quickNames,
});
const worker = (name: string, legalName: string | null = null): Worker => ({
  id: crypto.randomUUID(),
  name,
  role: null,
  legalName,
  document: null,
  phone: null,
  worksiteId: null,
  active: true,
  createdAt: "2026-01-01T00:00:00Z",
});
// foto diferente a cada chamada (o mesmo arquivo é reconhecido como duplicado)
const photo = (n: number) =>
  Buffer.concat([Buffer.from(PNG, "base64"), Buffer.from(`#${n}`)]).toString(
    "base64",
  );

describe("nome curto do material (domínio)", () => {
  const cp2 = mat("Cimento CP II 50 kg", "saco 50 kg", ["cimento"]);
  const cp3 = mat("Cimento CP III 50 kg", "saco 50 kg");
  const areia = mat("Areia média", "m³");
  it("'cimento' vale o padrão cadastrado, sem digitar o nome completo", () => {
    const r = extractRequest(
      "Preciso de 100 sacos de cimento daqui 3 dias",
      [cp2, cp3, areia],
      now,
    );
    expect(r.materialId).toBe(cp2.id);
    expect(r.quantity).toBe("100");
    expect(r.requiredDate).toBe("2026-11-22");
  });
  it("não troca por engano: outro tipo ou outra medida pede esclarecimento", () => {
    for (const t of [
      "100 sacos de cimento CP IV daqui 3 dias",
      "100 sacos de cimento 25 kg daqui 3 dias",
    ]) {
      const r = extractRequest(t, [cp2, areia], now);
      expect(r.materialId).toBeNull();
    }
    // nome completo de outro material tem prioridade sobre o nome curto
    expect(
      extractRequest(
        "100 sacos de Cimento CP III 50 kg daqui 3 dias",
        [cp2, cp3],
        now,
      ).materialId,
    ).toBe(cp3.id);
  });
  it("dois materiais com o mesmo nome curto: pergunta qual", () => {
    const other = mat("Cimento CP V 50 kg", "saco 50 kg", ["cimento"]);
    const r = extractRequest(
      "100 sacos de cimento daqui 3 dias",
      [cp2, other],
      now,
    );
    expect(r.materialId).toBeNull();
    expect(r.clarification).toContain("Qual deles?");
  });
});

describe("equipe: reconhecimento e comandos (domínio)", () => {
  const joao = worker("João Gesseiro", "João da Silva Santos");
  const marcos = worker("Marcos Pedreiro", "Marcos Pereira");
  const joaoB = worker("João Servente", "João Pereira");
  it("reconhece pelo nome completo do comprovante e nunca por palpite", () => {
    expect(
      matchWorker([joao, marcos], { name: "JOAO DA SILVA SANTOS" }, false)
        .worker,
    ).toBe(joao);
    expect(
      matchWorker([joao, marcos], { name: "JOAO SILVA" }, false).worker,
    ).toBe(joao);
    // só o primeiro nome no comprovante não basta
    expect(
      matchWorker([joao, marcos], { name: "JOAO" }, false).worker,
    ).toBeNull();
    expect(
      matchWorker([joao, marcos], { name: "CARLOS ALBERTO" }, false).worker,
    ).toBeNull();
    // digitado pelo proprietário, uma palavra única que identifica uma pessoa vale
    expect(matchWorker([joao, marcos], { name: "gesseiro" }, true).worker).toBe(
      joao,
    );
    expect(
      matchWorker([joao, joaoB], { name: "joão" }, true).worker,
    ).toBeNull();
    expect(
      matchWorker([joao, joaoB], { name: "joão" }, true).candidates,
    ).toHaveLength(2);
  });
  it("documento completo reconhece a pessoa", () => {
    const w = { ...marcos, document: "52998224725" };
    expect(
      matchWorker([joao, w], { document: "529.982.247-25" }, false).worker,
    ).toBe(w);
  });
  it("PAGUEI em uma ou várias linhas; qualquer linha ruim anula tudo", () => {
    expect(parseLaborPayments("PAGUEI João Gesseiro 1200")).toEqual([
      { name: "joao gesseiro", amount: "1200.00" },
    ]);
    expect(
      parseLaborPayments(
        "Pagamentos da semana:\nJoão Gesseiro 1.200,50\nMarcos Pedreiro - R$ 950",
      ),
    ).toEqual([
      { name: "joao gesseiro", amount: "1200.50" },
      { name: "marcos pedreiro", amount: "950.00" },
    ]);
    expect(parseLaborPayments("PAGUEI João Gesseiro\nMarcos 900")).toBeNull();
    expect(parseLaborPayments("PAGO 3200,00")).toBeNull();
    expect(parseOwnerCommand("PAGO 3200,00").kind).toBe("PAID");
    expect(parseOwnerCommand("paguei joão 100").kind).toBe("LABOR_PAID");
    expect(parseOwnerCommand("pagamentos de cheques").kind).not.toBe(
      "LABOR_PAID",
    );
  });
});

describe("mão de obra por comprovante no WhatsApp", () => {
  let t: Ctx;
  let proof: {
    amount: string | null;
    payeeName: string | null;
    payeeDocument: string | null;
    paidAt: string | null;
  };
  const ai: AIProvider = {
    mode: "mock",
    extractRequest: async (x, m, n) => extractRequest(x, m, n),
    extractDelivery: async () => null,
    extractProof: async () => ({
      legible: true,
      transactionId: null,
      ...proof,
    }),
  };
  beforeEach(async () => {
    t = await setup({ integrations: { ai } });
    proof = {
      amount: "1200.00",
      payeeName: "JOAO DA SILVA SANTOS",
      payeeDocument: null,
      paidAt: null,
    };
    for (const w of [
      {
        name: "João Gesseiro",
        role: "Gesseiro",
        legalName: "João da Silva Santos",
      },
      {
        name: "Marcos Pedreiro",
        role: "Pedreiro",
        legalName: "Marcos Pereira Lima",
      },
      { name: "Felipe Servente", role: "Servente" },
    ])
      expect((await t.call("/api/workers", t.owner, w)).status).toBe(201);
  });
  afterEach(async () => {
    await t.close();
  });
  const owner = () => t.state.contacts.find((c) => c.role === "owner")!.phone;
  const say = (text?: string, base64?: string) =>
    t.call("/api/simulator/whatsapp", t.owner, {
      from: owner(),
      ...(text ? { text } : {}),
      ...(base64
        ? {
            attachment: { fileName: "c.png", contentType: "image/png", base64 },
          }
        : {}),
    });
  const lastReply = async () =>
    (await t.refresh()).messages
      .filter((m) => m.recipient === owner() && m.direction === "outbound")
      .at(-1)!.text;

  it("foto do comprovante: reconhece quem recebeu, arquiva, lança em mão de obra e baixa o caixa; reenvio não duplica", async () => {
    const before = Number((await t.refresh()).cashFlow!.realizedBalance);
    const img = photo(1);
    await say(undefined, img);
    let s = await t.refresh();
    const e = s.cashEntries.find((x) => x.category === "LABOR")!;
    expect(e).toMatchObject({
      kind: "OUT",
      status: "PAID",
      amount: "1200.00",
      source: "WHATSAPP_PROOF",
    });
    expect(e.workerId).toBe(
      s.workers.find((w) => w.name === "João Gesseiro")!.id,
    );
    expect(e.attachmentId).toBeTruthy();
    expect(Number(s.cashFlow!.realizedBalance)).toBe(before - 1200);
    expect(await lastReply()).toContain("João Gesseiro");
    await say(undefined, img);
    s = await t.refresh();
    expect(s.cashEntries.filter((x) => x.category === "LABOR")).toHaveLength(1);
    expect(await lastReply()).toContain("já estava lançado");
  });
  it("comprovantes de várias pessoas na sexta: cada um no seu lugar", async () => {
    await say(undefined, photo(2));
    proof = { ...proof, amount: "950.00", payeeName: "Marcos Pereira Lima" };
    await say(undefined, photo(3));
    const s = await t.refresh();
    const by = (n: string) =>
      s.cashEntries.filter(
        (x) => x.workerId === s.workers.find((w) => w.name === n)!.id,
      );
    expect(by("João Gesseiro").map((x) => x.amount)).toEqual(["1200.00"]);
    expect(by("Marcos Pedreiro").map((x) => x.amount)).toEqual(["950.00"]);
  });
  it("nome desconhecido: não lança por palpite e explica como fazer", async () => {
    proof = { ...proof, payeeName: "CARLOS ALBERTO DIAS" };
    await say(undefined, photo(4));
    const s = await t.refresh();
    expect(s.cashEntries.filter((x) => x.category === "LABOR")).toHaveLength(0);
    expect(await lastReply()).toContain("PAGUEI");
    // o proprietário completa por texto; a foto enviada há pouco vira o comprovante
    await say("PAGUEI Felipe Servente 700");
    const after = await t.refresh();
    const e = after.cashEntries.find((x) => x.category === "LABOR")!;
    expect(e).toMatchObject({ amount: "700.00", source: "WHATSAPP_PROOF" });
    expect(e.attachmentId).toBeTruthy();
  });
  it("texto com várias pessoas lança tudo; linha desconhecida não lança nada", async () => {
    await say("PAGUEI Ninguém Conhecido 100");
    expect(
      (await t.refresh()).cashEntries.filter((x) => x.category === "LABOR"),
    ).toHaveLength(0);
    await say(
      "Pagamentos da semana:\nJoão Gesseiro 1200\nMarcos Pedreiro 950,50\nFelipe Servente 700",
    );
    const s = await t.refresh();
    expect(
      s.cashEntries
        .filter((x) => x.category === "LABOR")
        .map((x) => x.amount)
        .sort(),
    ).toEqual(["1200.00", "700.00", "950.50"]);
    expect(await lastReply()).toContain("Total novo");
  });
  it("cadastro: só o proprietário; nome repetido e CPF inválido são recusados; pagamento de inativo recusado", async () => {
    expect(
      (await t.call("/api/workers", t.requester, { name: "Teste Silva" }))
        .status,
    ).toBe(403);
    expect(
      (await t.call("/api/workers", t.owner, { name: "joão gesseiro" })).status,
    ).toBe(409);
    expect(
      (
        await t.call("/api/workers", t.owner, {
          name: "Novo Nome",
          document: "11111111111",
        })
      ).status,
    ).toBe(400);
    const w = (await t.refresh()).workers[0];
    await t.call(`/api/workers/${w.id}`, t.owner, { active: false }, "PATCH");
    expect(
      (
        await t.call("/api/labor-payments", t.owner, {
          workerId: w.id,
          amount: "10.00",
        })
      ).status,
    ).toBe(409);
  });
  it("pelo painel o escritório e o encarregado não lançam pagamento", async () => {
    const w = (await t.refresh()).workers[0];
    expect(
      (
        await t.call("/api/labor-payments", t.requester, {
          workerId: w.id,
          amount: "10.00",
        })
      ).status,
    ).toBe(403);
  });
});

describe("pedido do pedreiro só com 'cimento'", () => {
  let t: Ctx;
  beforeEach(async () => {
    t = await setup();
  });
  afterEach(async () => {
    await t.close();
  });
  it("já vira solicitação pronta com o cimento cadastrado", async () => {
    const requester = t.state.contacts.find(
      (c) => c.role === "site_requester",
    )!;
    const r = await t.call("/api/simulator/whatsapp", t.owner, {
      from: requester.phone,
      text: "Preciso de 100 sacos de cimento daqui 3 dias",
    });
    expect(r.status).toBe(200);
    const req = (await t.refresh()).requests[0];
    expect(req.status).toBe("READY_TO_QUOTE");
    expect(req.materialId).toBe(
      t.state.materials.find((m) => m.name === "Cimento CP II 50 kg")!.id,
    );
  });
});
