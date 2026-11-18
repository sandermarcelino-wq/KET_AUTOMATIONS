# ADR 0003 — Compras, teto de preço e aprovação do proprietário (Etapa 1)

Data: 2026-11-18. Estado: adotada para a Etapa 1. Complementa os ADRs 0001 e 0002.

## Fluxo implementado

```
solicitação QUOTING ── respostas de fornecedores (simuladas) ──► propostas (versionadas)
        │                                                        │
   close-quoting ◄───────────────────────────────────────────────┘
        ▼
  solicitação QUOTED ── comparação determinística ── escolha do proprietário
        ▼
  pedido PENDING_OWNER_APPROVAL (preparado ≠ autorizado; nada enviado)
        ▼  approve {versão, hash[, approvePriceCap]}   (somente owner)
  WAITING_SUPPLIER_CONFIRMATION ──► CONFIRMED
        │                      ├─► SUPPLIER_UNAVAILABLE (volta a QUOTED)
        │                      ├─► SUPPLIER_UNCONFIRMED (sem resposta; ainda ativo)
        └─ fornecedor altera termos ─► PENDING_OWNER_APPROVAL v+1 (aprovação anterior INVALIDADA)
```

Também: `REJECTED`, `CANCELLED`, `EXPIRED` (aprovação vale 48 h). Solicitação: `QUOTED`, `SUBMITTED_FOR_APPROVAL`, `ORDERED`.

## Decisões

1. **Duas autorizações separadas.** `price_authorizations` guarda o teto unitário por *obra + material + condição de pagamento* (padrão seguro da seção 5.3). `purchase_approvals` guarda a aprovação de **cada** compra. Um teto já autorizado dispensa novo aceite *do preço* (R$ 32 → R$ 32), nunca a aprovação da compra. A necessidade de novo teto é **reavaliada no momento da aprovação**, não só na preparação.
2. **Preço-base.** É o preço original da menor versão **congelada** do orçamento que contém o material; versões posteriores não o reescrevem. Sem base nem teto → o sistema exige decisão do proprietário (nunca inventa teto). Teto efetivo = maior entre base e teto autorizado vigente.
3. **Comparação** (`packages/domain/src/purchasing.ts`): total = quantidade × preço + frete + outros custos obrigatórios, em decimal. Componente ausente (preço, frete, prazo, pagamento), especificação não confirmada ou disponibilidade parcial ⇒ proposta *incomparável*, nunca vencedora. Vencedora = menor total entre as que cumprem o prazo (desempate por prazo e fornecedor). Se a mais barata falha no prazo, não há seleção automática dela: listam-se alternativas e o custo incremental. Frete fica no custo total; o teto compara só o preço unitário.
4. **Aprovação inequívoca.** `approve` exige `version` e `hash` (SHA-256 dos termos + número + versão). Texto livre “aprovar” não autoriza (T19). Repetir a aprovação (inclusive 5 requisições simultâneas) devolve a mesma aprovação (idempotência) e envia uma única mensagem ao fornecedor.
5. **Mudança após aprovação.** Resposta do fornecedor com qualquer termo diferente (preço, quantidade, frete, prazo, pagamento) invalida a aprovação, incrementa a versão, recalcula a necessidade de teto e pede nova decisão; o fornecedor é instruído a não faturar.
6. **Defesa no banco** (migração `003_purchasing.sql`): gatilhos impedem pedido em `APPROVED/WAITING/CONFIRMED` sem aprovação `VALID` da mesma versão, do mesmo hash e com `terms` idênticos; aprovações só podem passar de `VALID` a `INVALIDATED`; tetos só de `ACTIVE` a `SUPERSEDED`; propostas e pedidos não são excluídos; aprovações e tetos exigem contato com papel `owner`; total do pedido é recalculado; índice parcial garante **um pedido ativo por solicitação**. RLS e `FORCE ROW LEVEL SECURITY` em todas as tabelas novas.
7. **Concorrência.** Transações serializadas no PGlite + restrições únicas (`(tenant, request) WHERE active`, `(tenant, order, version)`, chaves de idempotência de mensagens de fornecedor) tornam duplicidade impossível mesmo sob disparos paralelos. Uma expiração é confirmada (commit) antes de devolver o erro.
8. **Urgência.** Pedido mais caro que a menor proposta, fora do prazo ou de solicitação urgente exige justificativa; o cartão do proprietário traz material, quantidade, data necessária, preço habitual (último pedido confirmado, senão base), preço emergencial, diferença em R$ e %.
9. **Sigilo comercial.** Mensagens a fornecedores contêm somente os termos do próprio fornecedor; testes verificam ausência de preços de concorrentes, orçamento e teto.
10. **Quem pode o quê.** Preparar, aprovar, rejeitar, cancelar e registrar respostas simuladas: `owner`. Escritório: leitura. Encarregado: não vê propostas, preços nem pedidos.

## Limites conscientes (não implementados / a decidir)

- Respostas de fornecedores entram por simulador no painel; `parseSupplierReply` é um interpretador de regras, não IA, e deixa ambiguidades para esclarecimento.
- Um pedido por solicitação (material único). Divisão de uma solicitação em vários pedidos e fornecedores fica para evolução.
- `PIX_ANTECIPADO` e `CHEQUE_PARCELADO` são apenas condições registradas: **não há** solicitação de chave Pix, comprovante, cheques ou agenda (Etapa 2). Pedido confirmado não é faturado, entregue nem pago.
- Prazo de resposta/expiração de cotações por tarefa agendada e notificações reais dependem de jobs e WhatsApp oficial (Etapas 3–4); hoje o encerramento é manual e as notificações são mensagens simuladas.
- Número mínimo de propostas (`MIN_COMPARABLE_QUOTES`, padrão 2) e validade da aprovação (48 h) são configuráveis por constante/variável; confirmar valores com o proprietário.
- Equivalência de marcas: não há cadastro de marcas equivalentes; o proprietário marca a proposta como não confirmada até esclarecer.
