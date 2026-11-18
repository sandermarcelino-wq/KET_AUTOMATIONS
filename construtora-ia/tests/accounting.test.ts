import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { buildAccessKey } from "../packages/domain/src/index.js";
import { setup } from "./helpers.js";

type Ctx = Awaited<ReturnType<typeof setup>>;
const day = (n: number) =>
  new Date(Date.now() + n * 86400000 - 3 * 3600000).toISOString().slice(0, 10);
const ymd = (iso: string) => iso.replaceAll("-", "");
const month = () => new Date().toISOString().slice(0, 7);
const CNPJ = "11222333000181";
const nfe = (key: string, total: string, cnpj = CNPJ, number = "123") =>
  Buffer.from(
    `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe${key}"><ide><nNF>${number}</nNF><serie>1</serie><dhEmi>${day(0)}T10:00:00-03:00</dhEmi></ide><emit><CNPJ>${cnpj}</CNPJ><xNome>Casa Forte</xNome></emit><det><prod><xProd>Cimento</xProd><qCom>100</qCom><vUnCom>30.00</vUnCom><vProd>${total}</vProd></prod></det><total><ICMSTot><vNF>${total}</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`,
  ).toString("base64");
const att = (fileName: string, contentType: string, base64: string) => ({
  fileName,
  contentType,
  base64,
});
let seq = 0;
const newKey = () =>
  buildAccessKey(
    (
      BigInt("3526121122233300018155001000000100000000000") + BigInt(++seq)
    ).toString(),
  );

describe("Etapa 4: extratos, conciliação, notas fiscais, fechamento contábil, promoções, exportações", () => {
  let t: Ctx;
  beforeEach(async () => {
    t = await setup();
  });
  afterEach(async () => {
    await t.close();
  });
  const ofx = (
    rows: { fitid: string; date: string; amount: string; memo: string }[],
  ) =>
    `OFXHEADER:100\n<OFX><STMTTRN>${rows.map((r) => `<TRNTYPE>X<DTPOSTED>${ymd(r.date)}<TRNAMT>${r.amount}<FITID>${r.fitid}<MEMO>${r.memo}</STMTTRN><STMTTRN>`).join("")}</STMTTRN></OFX>`.replace(
      /<STMTTRN><\/STMTTRN>/,
      "",
    );
  async function account() {
    return (
      await t.call("/api/bank-accounts", t.owner, {
        name: "Conta fictícia",
        openingBalance: "1000.00",
        openingDate: day(-30),
      })
    ).body;
  }
  async function pixObligation(
    unitPrice = "30.00",
    supplierName = "Casa Forte",
  ) {
    const { order, supplier } = await t.confirmedOrder({
      unitPrice,
      terms: "PIX_ANTECIPADO",
      supplierName,
    });
    await t.call(`/api/purchase-orders/${order.id}/payment-plan`, t.owner, {
      kind: "PIX",
      count: 1,
      firstDueDate: day(0),
    });
    const ob = (await t.refresh()).obligations.find(
      (o) => o.orderId === order.id,
    )!;
    return { order, supplier, ob };
  }
  const importFile = (
    accountId: string,
    content: string,
    fileName = "extrato.ofx",
  ) =>
    t.call("/api/bank-statements", t.owner, { accountId, fileName, content });

  it("OFX: sugere só com valor+data+contraparte; mesmo valor sem contraparte vai à revisão; nada é conciliado sem confirmação do proprietário", async () => {
    const acc = await account();
    const { ob } = await pixObligation();
    const rows = [
      {
        fitid: "FIT0000001",
        date: day(0),
        amount: "-3000.00",
        memo: "PIX ENVIADO CASA FORTE MATERIAIS",
      },
      {
        fitid: "FIT0000002",
        date: day(0),
        amount: "-3000.00",
        memo: "PIX ENVIADO JOAO DA SILVA",
      },
      { fitid: "FIT0000003", date: day(0), amount: "55.00", memo: "TARIFA" },
    ];
    const res = await importFile(acc.id, ofx(rows));
    expect(res.status).toBe(201);
    expect(res.body.import).toMatchObject({
      format: "OFX",
      lines: 3,
      suggested: 1,
      duplicates: 0,
    });
    const lines = (await t.refresh()).statementLines;
    expect(lines.find((l) => l.externalId === "FIT0000001")).toMatchObject({
      status: "SUGGESTED",
      suggestion: { kind: "OBLIGATION", id: ob.id },
    });
    expect(lines.find((l) => l.externalId === "FIT0000002")!.status).toBe(
      "REVIEW",
    );
    expect(lines.find((l) => l.externalId === "FIT0000003")!.status).toBe(
      "UNMATCHED",
    );
    expect(
      (await t.refresh()).obligations.find((o) => o.id === ob.id)!.status,
    ).toBe("SCHEDULED"); // sugerida ≠ conciliada
    // T16: o mesmo arquivo duas vezes ⇒ um só evento bancário
    const again = await importFile(acc.id, ofx(rows));
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("DUPLICATE_IMPORT");
    // arquivo diferente com lançamento já importado (períodos sobrepostos) ⇒ alerta, sem duplicar
    const overlap = await importFile(
      acc.id,
      ofx([
        rows[0],
        { fitid: "FIT0000009", date: day(0), amount: "-10.00", memo: "OUTRO" },
      ]),
      "outro.ofx",
    );
    expect(overlap.body.import).toMatchObject({ lines: 1, duplicates: 1 });
    expect(overlap.body.alert).toContain("já existiam");
    expect((await t.refresh()).statementLines).toHaveLength(4);
  });
  it("sem FITID, lançamentos idênticos no mesmo arquivo continuam distintos, mas reimportar em outro arquivo não duplica", async () => {
    const acc = await account();
    const noId = [
      "data;descricao;valor",
      `${day(0).split("-").reverse().join("/")};TED TESTE;-10,00`,
      `${day(0).split("-").reverse().join("/")};TED TESTE;-10,00`,
    ].join("\n");
    expect((await importFile(acc.id, noId, "a.csv")).body.import.lines).toBe(2);
    const second = await importFile(
      acc.id,
      noId + "\n" + `${day(1).split("-").reverse().join("/")};NOVO;-1,00`,
      "b.csv",
    );
    expect(second.body.import).toMatchObject({ lines: 1, duplicates: 2 });
  });
  it("confirmação da sugestão concilia a obrigação; valor divergente e reuso do compromisso são recusados; em lote só as sugestões seguras", async () => {
    const acc = await account();
    const { ob } = await pixObligation();
    const { ob: ob2 } = await pixObligation("31.00", "Depósito São Bento");
    await importFile(
      acc.id,
      ofx([
        {
          fitid: "FIT0000011",
          date: day(0),
          amount: "-3000.00",
          memo: "PIX CASA FORTE MATERIAIS",
        },
        {
          fitid: "FIT0000012",
          date: day(0),
          amount: "-3100.00",
          memo: "PIX DEPOSITO SAO BENTO",
        },
        {
          fitid: "FIT0000013",
          date: day(0),
          amount: "-3000.00",
          memo: "PIX ALGUEM",
        },
      ]),
    );
    const lines = (await t.refresh()).statementLines;
    const l1 = lines.find((l) => l.externalId === "FIT0000011")!;
    const l3 = lines.find((l) => l.externalId === "FIT0000013")!;
    expect(
      (
        await t.call(
          `/api/bank-lines/${l1.id}/confirm-suggestion`,
          t.requester,
          {},
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await t.call(`/api/bank-lines/${l3.id}/match`, t.owner, {
          kind: "OBLIGATION",
          targetId: ob2.id,
        })
      ).body.code,
    ).toBe("AMOUNT_MISMATCH"); // valor diferente
    expect(
      (await t.call(`/api/bank-lines/${l1.id}/confirm-suggestion`, t.owner, {}))
        .status,
    ).toBe(200);
    expect(
      (await t.refresh()).obligations.find((o) => o.id === ob.id)!.status,
    ).toBe("RECONCILED");
    expect(
      (
        await t.call(`/api/bank-lines/${l3.id}/match`, t.owner, {
          kind: "OBLIGATION",
          targetId: ob.id,
        })
      ).status,
    ).toBe(409); // já conciliada
    expect(
      (await t.call(`/api/bank-lines/${l1.id}/confirm-suggestion`, t.owner, {}))
        .status,
    ).toBe(409);
    const batch = await t.call(
      "/api/bank-lines/confirm-all-suggestions",
      t.owner,
      { confirmed: true },
    );
    expect(batch.body).toEqual({ reconciled: 1, skipped: 0 });
    const s = await t.refresh();
    expect(s.obligations.find((o) => o.id === ob2.id)!.status).toBe(
      "RECONCILED",
    );
    expect(s.statementLines.find((l) => l.id === l3.id)!.status).toBe("REVIEW"); // sem correspondência segura
    expect(
      (
        await t.call(`/api/bank-lines/${l3.id}/ignore`, t.owner, {
          reason: "Não identificado",
        })
      ).body.status,
    ).toBe("IGNORED");
    await expect(
      t.instance.db.query(
        "UPDATE bank_statement_lines SET data=jsonb_set(data,'{amount}','\"1.00\"')",
      ),
    ).rejects.toThrow(/imutáveis/);
    await expect(
      t.instance.db.query("DELETE FROM bank_matches"),
    ).rejects.toThrow();
  });
  it("entrada no extrato concilia com parcela de comprador e gera recebimento (método EXTRATO)", async () => {
    const acc = await account();
    const worksiteId = t.state.worksites[0].id;
    const unit = (
      await t.call("/api/units", t.owner, {
        worksiteId,
        code: "9",
        listPrice: "90000.00",
      })
    ).body;
    const buyer = (
      await t.call("/api/buyers", t.owner, {
        name: "Marcos Pereira Fictício",
        document: "529.982.247-25",
        legalBasis: "EXECUCAO_CONTRATO",
      })
    ).body;
    await t.call("/api/contracts", t.owner, {
      unitId: unit.id,
      buyerId: buyer.id,
      saleDate: day(-5),
      salePrice: "90000.00",
      entryAmount: "0.00",
      entryDueDate: day(0),
      count: 1,
      firstDueDate: day(0),
      adjustment: { type: "NONE" },
    });
    await importFile(
      acc.id,
      ofx([
        {
          fitid: "FIT0000021",
          date: day(1),
          amount: "90000.00",
          memo: "TED MARCOS PEREIRA",
        },
      ]),
    );
    const line = (await t.refresh()).statementLines[0];
    expect(line.status).toBe("SUGGESTED");
    expect(
      (
        await t.call(
          `/api/bank-lines/${line.id}/confirm-suggestion`,
          t.owner,
          {},
        )
      ).status,
    ).toBe(200);
    const s = await t.refresh();
    expect(s.installments[0]).toMatchObject({
      status: "PAID",
      received: "90000.00",
    });
    expect(s.receipts[0].method).toBe("EXTRATO");
    expect(s.cashFlow!.realizedBalance).toBe("91000.00"); // saldo inicial + recebimento confirmado
    // outra empresa não vê extratos nem pode importar na conta alheia
    expect((await t.refresh(t.other)).statementLines).toEqual([]);
    expect(
      (
        await t.call("/api/bank-statements", t.other, {
          accountId: acc.id,
          fileName: "x.ofx",
          content: ofx([
            { fitid: "FIT0000099", date: day(0), amount: "1.00", memo: "x" },
          ]),
        })
      ).status,
    ).toBe(404);
  });

  async function supplierWithCnpj(name = "Casa Forte") {
    const sup = t.supplier(name);
    await t.call(
      `/api/suppliers/${sup.id}`,
      t.owner,
      { cnpj: "11.222.333/0001-81" },
      "PATCH",
    );
    return sup;
  }
  it("T13: NF-e (XML) vincula ao pedido por emitente+valor; o mesmo XML/chave não duplica; valor divergente e XML malicioso são tratados", async () => {
    await supplierWithCnpj();
    const { order } = await t.confirmedOrder();
    const key = newKey();
    const up = (xml: string, extra: object = {}) =>
      t.call("/api/fiscal-documents", t.owner, {
        xml: att("nf.xml", "text/xml", xml),
        ...extra,
      });
    const first = await up(nfe(key, "3000.00"));
    expect(first.status).toBe(201);
    expect(first.body.document).toMatchObject({
      status: "LINKED",
      orderId: order.id,
      accessKey: key,
      total: "3000.00",
    });
    const dup = await up(nfe(key, "3000.00"));
    expect(dup.body.duplicate).toBe(true);
    const dupOtherBytes = await up(nfe(key, "3000.00", CNPJ, "999")); // mesma chave, XML reapresentado
    expect(dupOtherBytes.body.duplicate).toBe(true);
    expect((await t.refresh()).fiscalDocuments).toHaveLength(1);
    expect(
      (await t.refresh()).orders.filter((o) => o.id === order.id),
    ).toHaveLength(1); // nenhuma compra criada
    // divergência de valor
    const { order: o2 } = await t.confirmedOrder({
      supplierName: "Casa Forte",
    });
    const div = await up(nfe(newKey(), "2999.00"), { orderId: o2.id });
    expect(div.body.document.status).toBe("DIVERGENT");
    expect(div.body.document.issues.join()).toContain("difere");
    expect(
      (await t.refresh()).messages.some(
        (m) => m.text.includes("Nota fiscal") && m.text.includes("divergência"),
      ),
    ).toBe(true);
    // chave inválida, DTD e conteúdo que não é XML
    expect((await up(nfe("1".repeat(44), "3000.00"))).status).toBe(400);
    expect(
      (
        await up(
          Buffer.from(
            '<!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]><nfeProc/>',
          ).toString("base64"),
        )
      ).status,
    ).toBe(400);
    expect(
      (await up(Buffer.from("MZ binario").toString("base64"))).status,
    ).toBe(400);
    expect(
      (
        await t.call("/api/fiscal-documents", t.requester, {
          xml: att("a.xml", "text/xml", nfe(newKey(), "1.00")),
        })
      ).status,
    ).toBe(403);
  });
  it("PDF sem XML fica sem vínculo até o proprietário vincular; um pedido não aceita duas notas", async () => {
    const { order } = await t.confirmedOrder();
    const pdf = Buffer.from("%PDF-1.4 nota").toString("base64");
    const r = await t.call("/api/fiscal-documents", t.owner, {
      pdf: att("nota.pdf", "application/pdf", pdf),
    });
    expect(r.body.document.status).toBe("UNLINKED");
    const link = await t.call(
      `/api/fiscal-documents/${r.body.document.id}/link`,
      t.owner,
      { orderId: order.id },
    );
    expect(link.body.status).toBe("LINKED");
    const r2 = await t.call("/api/fiscal-documents", t.owner, {
      pdf: att(
        "nota2.pdf",
        "application/pdf",
        Buffer.from("%PDF-1.4 outra").toString("base64"),
      ),
    });
    expect(
      (
        await t.call(
          `/api/fiscal-documents/${r2.body.document.id}/link`,
          t.owner,
          { orderId: order.id },
        )
      ).status,
    ).toBe(409);
  });
  it("T17: fechamento mensal cobra só os documentos que faltam, sem repetir; pacote por empresa/obra/competência; envio só após aprovação", async () => {
    await supplierWithCnpj();
    const orders = [
      await t.confirmedOrder(),
      await t.confirmedOrder(),
      await t.confirmedOrder({ supplierName: "Depósito São Bento" }),
    ];
    await t.call("/api/fiscal-documents", t.owner, {
      xml: att("a.xml", "text/xml", nfe(newKey(), orders[0].order.terms.total)),
      orderId: orders[0].order.id,
    });
    const m = month();
    const check = await t.call(`/api/accounting/${m}/check`, t.owner);
    expect(check.body.pendingDocuments).toHaveLength(2);
    expect(
      (await t.call(`/api/accounting/2026-13/check`, t.owner)).status,
    ).toBe(400);
    const before = (await t.refresh()).messages.length;
    const req = await t.call(
      `/api/accounting/${m}/request-missing`,
      t.owner,
      {},
    );
    expect(req.body).toMatchObject({
      pending: 2,
      requested: 2,
      alreadyRequested: 0,
    });
    const msgs = (await t.refresh()).messages
      .slice(before - 0)
      .filter((x) => x.text.includes("envie o XML e o PDF"));
    expect(msgs).toHaveLength(2);
    expect(
      msgs.every((x) => x.text.includes("Não pedimos emissão retroativa")),
    ).toBe(true);
    expect(
      (await t.call(`/api/accounting/${m}/request-missing`, t.owner, {})).body,
    ).toMatchObject({ requested: 0, alreadyRequested: 2 });
    // pacote
    const pkg = (await t.call(`/api/accounting/${m}/package`, t.owner, {}))
      .body;
    expect(pkg).toMatchObject({
      status: "DRAFT",
      version: 1,
      missingDocuments: 2,
    });
    const zip = await t.instance.app.request(
      `/api/attachments/${pkg.attachmentId}`,
      { headers: { Authorization: `Bearer ${t.owner.token}` } },
    );
    expect(zip.headers.get("content-type")).toBe("application/zip");
    const files = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    const names = Object.keys(files);
    expect(
      names.some(
        (n) =>
          n.includes("Residencial Aurora") && n.endsWith(`${m}/compras.csv`),
      ),
    ).toBe(true);
    expect(names.some((n) => n.endsWith("RESUMO.txt"))).toBe(true);
    expect(
      names.some((n) => n.includes("/fiscais/") && n.endsWith(".xml")),
    ).toBe(true);
    expect(
      strFromU8(
        files[names.find((n) => n.endsWith("pendencias_documentais.csv"))!],
      ),
    ).toContain("Pedido 000");
    expect(
      (await t.call(`/api/accounting/${m}/package`, t.owner, {})).body.version,
    ).toBe(2);
    // envio ao contador
    const acc = (
      await t.call("/api/accountants", t.owner, {
        name: "Contador Fictício",
        email: "contador@exemplo.com",
      })
    ).body;
    expect(
      (
        await t.call(`/api/accountants`, t.owner, {
          name: "x",
          email: "invalido",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await t.call(`/api/accounting/packages/${pkg.id}/send`, t.owner, {
          accountantId: acc.id,
        })
      ).body.code,
    ).toBe("NOT_APPROVED");
    expect(
      (
        await t.call(
          `/api/accounting/packages/${pkg.id}/approve`,
          t.requester,
          {},
        )
      ).status,
    ).toBe(403);
    await t.call(`/api/accounting/packages/${pkg.id}/approve`, t.owner, {});
    const sent = await t.call(
      `/api/accounting/packages/${pkg.id}/send`,
      t.owner,
      { accountantId: acc.id },
    );
    expect(sent.body).toMatchObject({
      mode: "SIMULATED",
      package: { status: "SENT", sentTo: "contador@exemplo.com" },
    });
    expect(sent.body.note).toContain("simulado");
    expect(
      (
        await t.call(`/api/accounting/packages/${pkg.id}/send`, t.owner, {
          accountantId: acc.id,
        })
      ).body.code,
    ).toBe("ALREADY_SENT");
    expect(
      (
        await t.call(`/api/accounting/packages/${pkg.id}/send`, t.owner, {
          accountantId: acc.id,
          resend: true,
        })
      ).status,
    ).toBe(200);
    // isolamento do pacote
    expect(
      (
        await t.instance.app.request(`/api/attachments/${pkg.attachmentId}`, {
          headers: { Authorization: `Bearer ${t.other.token}` },
        })
      ).status,
    ).toBe(404);
    expect((await t.refresh(t.other)).accountingPackages).toEqual([]);
  });
  it("e-mail real só com SMTP configurado e modo real; falha de envio é registrada", async () => {
    const calls: unknown[] = [];
    const live = await setup({
      integrations: {
        live: true,
        mailer: {
          send: async (m) => {
            calls.push(m.subject);
            if (m.to.startsWith("falha")) throw new Error("SMTP indisponível");
          },
        },
      },
    });
    const acc = (
      await live.call("/api/accountants", live.owner, {
        name: "C",
        email: "ok@exemplo.com",
      })
    ).body;
    const bad = (
      await live.call("/api/accountants", live.owner, {
        name: "F",
        email: "falha@exemplo.com",
      })
    ).body;
    const pkg = (
      await live.call(`/api/accounting/${month()}/package`, live.owner, {})
    ).body;
    await live.call(
      `/api/accounting/packages/${pkg.id}/approve`,
      live.owner,
      {},
    );
    expect(
      (
        await live.call(`/api/accounting/packages/${pkg.id}/send`, live.owner, {
          accountantId: acc.id,
        })
      ).body.mode,
    ).toBe("SMTP");
    expect(calls).toHaveLength(1);
    const pkg2 = (
      await live.call(`/api/accounting/${month()}/package`, live.owner, {})
    ).body;
    await live.call(
      `/api/accounting/packages/${pkg2.id}/approve`,
      live.owner,
      {},
    );
    expect(
      (
        await live.call(
          `/api/accounting/packages/${pkg2.id}/send`,
          live.owner,
          { accountantId: bad.id },
        )
      ).body.package.status,
    ).toBe("SEND_FAILED");
    await live.close();
  });
  it("promoções: texto do fornecedor vira promoção com economia potencial; nunca gera compra", async () => {
    const sup = t.supplier("Casa Forte");
    const { order } = await t.confirmedOrder({ unitPrice: "32.00" });
    const r = await t.call("/api/promotions/from-message", t.owner, {
      supplierId: sup.id,
      text: "Promoção! Cimento CP II 50 kg por R$ 28,50 até 30/12",
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      promoPrice: "28.50",
      normalPrice: "32.00",
      remainingQuantity: "900",
      potentialSavings: "3150.00",
      source: "Mensagem do fornecedor",
    });
    expect(r.body.validUntil).toMatch(/-12-30$/);
    const s = await t.refresh();
    expect(s.orders.filter((o) => o.id !== order.id)).toHaveLength(0); // nenhuma compra automática
    expect(
      s.notifications.some(
        (n) => n.kind === "PROMOTION" && n.priority === "HIGH",
      ),
    ).toBe(true); // economia ≥ R$ 1.000
    expect(
      (
        await t.call("/api/promotions/from-message", t.owner, {
          supplierId: sup.id,
          text: "Promoção imperdível!!!",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await t.call("/api/promotions", t.requester, {
          supplierId: sup.id,
          materialId: s.materials[0].id,
          promoPrice: "1.00",
        })
      ).status,
    ).toBe(403);
  });
  it("exportações CSV: só proprietário/escritório, cabeçalhos estáveis e proteção contra injeção de fórmulas", async () => {
    const sup = t.supplier("Casa Forte");
    await t.confirmedOrder();
    await t.call(
      `/api/suppliers/${sup.id}`,
      t.owner,
      { name: '=HYPERLINK("http://x")' },
      "PATCH",
    );
    const res = await t.call("/api/exports/compras.csv", t.owner);
    expect(res.status).toBe(200);
    expect(res.body).toContain('"pedido";"versao";"fornecedor"');
    expect(res.body).toContain("\"'=HYPERLINK");
    expect(res.body).not.toMatch(/;"=HYPERLINK/);
    expect((await t.call("/api/exports/custos.csv", t.readonly)).status).toBe(
      200,
    );
    expect((await t.call("/api/exports/pagamentos.csv", t.owner)).status).toBe(
      200,
    );
    expect((await t.call("/api/exports/recebiveis.csv", t.owner)).status).toBe(
      200,
    );
    expect((await t.call("/api/exports/compras.csv", t.requester)).status).toBe(
      403,
    );
    expect((await t.call("/api/exports/segredos.csv", t.owner)).status).toBe(
      404,
    );
  });
});
