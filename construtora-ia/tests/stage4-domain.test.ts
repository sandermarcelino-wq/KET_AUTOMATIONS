import { describe, it, expect } from "vitest";
import {
  approvalCode,
  buildAccessKey,
  counterpartyEvidence,
  isExplicitSupplierConfirmation,
  isValidAccessKey,
  matchLine,
  parseDeliveryText,
  parseMetaWebhook,
  parseNfeXml,
  parseOfx,
  parseOwnerCommand,
  parseStatementCsv,
  signMeta,
  verifyMetaSignature,
  windowOpen,
} from "../packages/domain/src/index.js";

const OFX = `OFXHEADER:100\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261210120000[-3:BRT]<TRNAMT>-3200.00<FITID>20261210001<MEMO>PIX ENVIADO CASA FORTE MATERIAIS</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261211<TRNAMT>90000.00<FITID>0<MEMO>TED COMPRADOR A</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261211<TRNAMT>90000.00<FITID>0<MEMO>TED COMPRADOR A</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
describe("extratos", () => {
  it("OFX: FITID confiável vira id; sem FITID usa hash com sequência (dois lançamentos idênticos no mesmo arquivo continuam distintos)", () => {
    const lines = parseOfx(OFX);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({
      externalId: "20261210001",
      date: "2026-12-10",
      amount: "-3200.00",
    });
    expect(lines[1].externalId).toBeNull();
    expect(lines[1].hash).not.toBe(lines[2].hash);
    expect(parseOfx(OFX)[1].hash).toBe(lines[1].hash); // determinístico: reimportar gera o mesmo hash
    expect(() => parseOfx("lixo")).toThrow();
  });
  it("CSV brasileiro", () => {
    const l = parseStatementCsv(
      "data;descricao;valor;id\n10/12/2026;PIX CASA FORTE;-3.200,00;ABC123456\n11/12/2026;TED;1.500,50;",
    );
    expect(l.map((x) => [x.date, x.amount, x.externalId])).toEqual([
      ["2026-12-10", "-3200.00", "ABC123456"],
      ["2026-12-11", "1500.50", null],
    ]);
    expect(() =>
      parseStatementCsv("data;descricao;valor\n31/02/x;a;1"),
    ).toThrow();
  });
});
describe("conciliação conservadora", () => {
  const ob = {
    kind: "OBLIGATION" as const,
    id: "o1",
    amount: "3200.00",
    date: "2026-12-10",
    names: ["Casa Forte Materiais", "11222333000181"],
  };
  const line = (over: object = {}) => ({
    externalId: "X1",
    date: "2026-12-10",
    amount: "-3200.00",
    memo: "PIX ENVIADO CASA FORTE",
    hash: "h",
    ...over,
  });
  it("valor + data + contraparte + candidato único ⇒ sugerido", () => {
    expect(matchLine(line(), [ob]).status).toBe("SUGGESTED");
  });
  it("mesmo valor sem contraparte NÃO concilia (revisão); data fora da janela também não", () => {
    expect(matchLine(line({ memo: "PIX ENVIADO JOAO" }), [ob]).status).toBe(
      "REVIEW",
    );
    expect(matchLine(line({ date: "2026-12-20" }), [ob]).status).toBe("REVIEW");
    expect(matchLine(line({ amount: "-3199.99" }), [ob]).status).toBe("NONE");
  });
  it("dois candidatos idênticos ⇒ revisão manual; entrada só casa com recebível", () => {
    expect(matchLine(line(), [ob, { ...ob, id: "o2" }]).status).toBe("REVIEW");
    expect(matchLine(line({ amount: "3200.00" }), [ob]).status).toBe("NONE");
    expect(
      matchLine(line({ amount: "3200.00" }), [{ ...ob, kind: "INSTALLMENT" }])
        .status,
    ).toBe("SUGGESTED");
  });
  it("evidência de contraparte por documento ou token distintivo", () => {
    expect(
      counterpartyEvidence("PAG CNPJ 11222333000181", ["x 11222333000181"]),
    ).toBe(true);
    expect(
      counterpartyEvidence("PIX LOJA", ["Casa Forte Materiais Ltda"]),
    ).toBe(false);
  });
});
describe("NF-e", () => {
  const key = buildAccessKey("3526121122233300018155001000000123100000001");
  const xml = (k: string) =>
    `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe${k}"><ide><nNF>123</nNF><serie>1</serie><dhEmi>2026-12-05T10:00:00-03:00</dhEmi></ide><emit><CNPJ>11222333000181</CNPJ><xNome>Casa Forte</xNome></emit><det><prod><xProd>Cimento CP II</xProd><qCom>100.0000</qCom><vUnCom>32.0000</vUnCom><vProd>3200.00</vProd></prod></det><total><ICMSTot><vNF>3200.00</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`;
  it("valida chave (DV mod 11) e extrai campos", () => {
    expect(isValidAccessKey(key)).toBe(true);
    expect(
      isValidAccessKey(key.slice(0, 43) + ((Number(key[43]) + 1) % 10)),
    ).toBe(false);
    expect(parseNfeXml(xml(key))).toMatchObject({
      accessKey: key,
      number: "123",
      issuedOn: "2026-12-05",
      issuerCnpj: "11222333000181",
      total: "3200.00",
    });
  });
  it("rejeita XML malicioso ou inválido", () => {
    expect(() =>
      parseNfeXml(
        '<!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]><nfeProc/>',
      ),
    ).toThrow(/DTD/);
    expect(() => parseNfeXml(xml("1".repeat(44)))).toThrow(/inválida/);
    expect(() => parseNfeXml("<a/>")).toThrow();
  });
});
describe("WhatsApp", () => {
  it("assinatura HMAC: aceita a correta; recusa ausente, errada ou sem segredo", () => {
    const body = JSON.stringify({ a: 1 });
    const sig = signMeta(body, "segredo");
    expect(verifyMetaSignature(body, sig, "segredo")).toBe(true);
    expect(verifyMetaSignature(body + " ", sig, "segredo")).toBe(false);
    expect(verifyMetaSignature(body, undefined, "segredo")).toBe(false);
    expect(verifyMetaSignature(body, sig, "")).toBe(false);
    expect(verifyMetaSignature(body, "sha256=zz", "segredo")).toBe(false);
  });
  it("normaliza payload da Meta (texto, imagem) e ignora lixo", () => {
    const msgs = parseMetaWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "PN1" },
                messages: [
                  {
                    id: "wamid.1",
                    from: "5511999990000",
                    type: "text",
                    text: { body: "Oi" },
                    timestamp: "1700000000",
                  },
                  {
                    id: "wamid.2",
                    from: "5511999990000",
                    type: "image",
                    image: { id: "MEDIA1", mime_type: "image/jpeg" },
                    timestamp: "1700000001",
                  },
                  { id: "", from: "x", type: "text" },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({
      id: "wamid.1",
      from: "+5511999990000",
      type: "text",
      text: "Oi",
      phoneNumberId: "PN1",
    });
    expect(msgs[1]).toMatchObject({ type: "image", mediaId: "MEDIA1" });
    expect(parseMetaWebhook(null)).toEqual([]);
  });
  it("janela de 24 h", () => {
    const now = new Date("2026-12-10T12:00:00Z");
    expect(windowOpen("2026-12-09T13:00:00Z", now)).toBe(true);
    expect(windowOpen("2026-12-09T11:00:00Z", now)).toBe(false);
    expect(windowOpen(null, now)).toBe(false);
  });
  it("T19: comandos do proprietário — 'aprovar' sozinho não identifica pedido; código é determinístico por versão/hash", () => {
    expect(parseOwnerCommand("APROVAR")).toEqual({
      kind: "APPROVE",
      number: null,
      code: null,
      priceCap: false,
    });
    expect(parseOwnerCommand("aprovar 3 abc234 teto")).toEqual({
      kind: "APPROVE",
      number: 3,
      code: "ABC234",
      priceCap: true,
    });
    expect(parseOwnerCommand("rejeitar pedido 12")).toEqual({
      kind: "REJECT",
      number: 12,
    });
    expect(parseOwnerCommand("PAGO R$ 3.200,50")).toEqual({
      kind: "PAID",
      amount: "3200.50",
    });
    expect(
      parseOwnerCommand("Quanto temos para receber dos compradores este mês?"),
    ).toEqual({ kind: "QUERY", intent: "RECEIVABLE_MONTH" });
    expect(
      parseOwnerCommand("Quanto temos de cheques para pagar no mês seguinte?"),
    ).toEqual({ kind: "QUERY", intent: "CHEQUES_NEXT_MONTH" });
    expect(
      parseOwnerCommand("Quanto dinheiro teremos disponível daqui a 90 dias?"),
    ).toEqual({ kind: "QUERY", intent: "CASH_30_60_90" });
    expect(
      parseOwnerCommand("Qual o custo restante previsto para terminar a obra?"),
    ).toEqual({ kind: "QUERY", intent: "REMAINING_COST" });
    expect(parseOwnerCommand("bom dia")).toEqual({ kind: "UNKNOWN" });
    const c1 = approvalCode("s", "id", 1, "h");
    expect(c1).toMatch(/^[A-Z2-9]{6}$/);
    expect(approvalCode("s", "id", 1, "h")).toBe(c1);
    expect(approvalCode("s", "id", 2, "h")).not.toBe(c1);
    expect(approvalCode("outro", "id", 1, "h")).not.toBe(c1);
  });
  it("encarregado: NF e quantidade; fornecedor: confirmação precisa ser expressa", () => {
    expect(parseDeliveryText("NF 1234 80")).toEqual({
      documentNumber: "1234",
      quantity: "80",
      orderNumber: null,
    });
    expect(parseDeliveryText("nota 99-A 20,5 sacos pedido 3")).toEqual({
      documentNumber: "99-A",
      quantity: "20.5",
      orderNumber: 3,
    });
    expect(parseDeliveryText("chegou o cimento")).toBeNull();
    expect(isExplicitSupplierConfirmation("Tem sim")).toBe(false);
    expect(isExplicitSupplierConfirmation("Confirmo o pedido")).toBe(false);
    expect(
      isExplicitSupplierConfirmation(
        "Confirmo pedido com preço e prazo mantidos",
      ),
    ).toBe(true);
    expect(
      isExplicitSupplierConfirmation("Confirmado, de acordo com o pedido"),
    ).toBe(true);
  });
});
