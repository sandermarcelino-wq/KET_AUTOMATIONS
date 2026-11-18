# ADR 0005 — Vendas, recebíveis e fluxo de caixa (Etapa 3)

Data: 2026-11-18. Estado: adotada.

1. **Cadastros.** `property_units` (única por obra+código), `buyers` (CPF/CNPJ validado e único por empresa; **base legal LGPD obrigatória**; ocultos do encarregado), `sales_contracts` (um contrato `ACTIVE` por unidade, índice parcial), `contract_versions` (snapshots imutáveis), `receivable_installments`, `receipts`.
2. **Cada contrato carrega a sua regra** de correção: `NONE`, `FIXED_MONTHLY_PERCENT` (taxa cadastrada, composta por meses completos entre a venda e o vencimento; aplicação só por **prévia + confirmação**) ou `MANUAL_INDEX` (nenhum cálculo automático; ajuste manual com justificativa, autor e valores anterior/novo). O valor original da parcela é imutável (gatilho). Nenhum índice (INCC, IGP-M…) é inferido ou baixado.
3. **Previsto ≠ recebido.** A situação é derivada na leitura (`effectiveInstallmentStatus`): vencida e não paga é `OVERDUE`, nunca entra como dinheiro recebido; só um recebimento confirmado manualmente pelo proprietário baixa. `receipts` é somente acréscimo (estorno = lançamento negativo, idempotente) e um **gatilho** mantém `received`/`status` da parcela e impede soma negativa ou acima do valor. Idempotência por `clientRef`.
4. **Encargos** (multa e juros de mora cadastrados no contrato) são só uma **estimativa** exibida; para cobrá-los, o proprietário registra um ajuste da parcela com justificativa.
5. **Renegociação** cria nova versão do contrato, marca as parcelas abertas como `RENEGOTIATED` (preservadas) e gera novas parcelas com o saldo; **cancelamento** libera a unidade, cancela as parcelas abertas e mantém recebimentos.
6. **Fluxo de caixa** (`computeCashFlow` + `cashFlow()` de domínio): saldo realizado = saldo inicial das contas + recebimentos de compradores + entradas manuais pagas − obrigações de compra confirmadas − saídas manuais pagas. Projeção 30/60/90 = realizado + previsto de entrada − previsto de saída, rotulada como projeção; parcelas vencidas ficam fora (configurável); obrigações não confirmadas (inclusive `REPORTED`) permanecem como saída esperada. Alterar vencimento desloca a projeção sem criar dinheiro. Filtro por obra (contas bancárias só na visão da empresa). Métricas prontas para consulta por WhatsApp (receber no mês, cheques do mês seguinte, custo restante).
7. **Importador legado (CSV)** com prévia, validação linha a linha, confirmação e auditoria: unidades e parcelas de contratos sem cronograma (a soma deve fechar o preço; “pago” gera recebimento marcado como importado).
8. **Rotina:** parcelas de compradores vencidas disparam aviso único (`buyer-overdue:{id}`).

## Limites
- Confirmação de recebimento é manual até a importação de extratos (Etapa 4).
- Não há emissão de boletos, cobrança automática, cálculo de índices oficiais, nem contabilização de receita (competência).
