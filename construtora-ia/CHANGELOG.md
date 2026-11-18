# Histórico de alterações

## 0.3.0 — Etapa 2 (recebimento, Pix, cheques, rotinas) — 2026-11-18

- Recebimento documental com anexo privado, parcial/total/excesso/ilegível, sem duplicidade e sem relançar custo.
- Cronograma de pagamentos (Pix, cheques, boleto) com soma igual ao total do pedido; chaves Pix com verificação do proprietário; solicitação de Pix em duas mensagens; comprovantes informados ≠ confirmados; confirmação manual auditada.
- Rotinas agendadas idempotentes (vencimentos D-7/D-2/D0, vencidas, entregas atrasadas, cotação no prazo, aprovações expiradas, resumo de avisos) e configurações por empresa.
- Acompanhamento de custos (orçado × comprado × recebido × pago), cadastro completo de fornecedor, telas Recebimentos, Financeiro, Custos da obra e Configurações.
- Migração 004; ADR 0004.

## 0.2.0 — Software, Etapa 1 (compras e aprovações) — 2026-11-18

- Propostas de fornecedores (simuladas) com versões, comparação determinística (preço + frete + custos, prazo, pagamento, disponibilidade, especificação) e tratamento de proposta incomparável, indisponível e fornecedor sem resposta.
- Teto de preço evolutivo por obra + material + condição de pagamento, com orçamento-base preservado, histórico append-only e painel de desvios/controle de preço.
- Aprovação exclusiva do proprietário para toda compra, ligada à versão e ao hash do pedido; autorização de teto separada; invalidação quando o fornecedor altera preço, quantidade, frete, prazo ou pagamento; expiração em 48 h; idempotência sob concorrência.
- Pedido formal simulado ao fornecedor com o aviso de não faturar/despachar se algo mudar; confirmação expressa, indisponibilidade, cancelamento e sem resposta.
- Urgência: justificativa obrigatória e cartão ao proprietário com preço habitual × emergencial (R$ e %).
- Migração `003_purchasing.sql`: tabelas `supplier_quotes`, `price_authorizations`, `purchase_orders`, `purchase_approvals`, gatilhos de integridade, RLS e índice de um pedido ativo por solicitação.
- Painel: telas Compras (Aprovações, Cotações, Pedidos) e Preços e desvios. Corrigida rolagem horizontal móvel causada por `.sr-only` em tabelas.
- Refatoração: helpers comuns da API em `apps/api/src/common.ts`; componentes comuns do painel em `apps/admin/src/ui.tsx`.
- 80 testes (38 novos). Nenhuma integração real: WhatsApp, IA, Pix, cheques, recebimento e financeiro seguem nas Etapas 2+.

## 0.1.0 — Software, Etapa 0 — 2026-11-18

- Monorepo TypeScript com API Hono/Node, painel React/Vite e PostgreSQL embarcado PGlite para demonstração local.
- Cadastros de obras, fornecedores e materiais, orçamento versionado e congelamento, importação assistida de CSV e exportação.
- Fluxo de solicitação por texto/transcrição, esclarecimento e geração de convites simulados, com idempotência e auditoria.
- Perfis de demonstração, separação de organizações e acesso de solicitante limitado às obras autorizadas.
- Adaptadores MockAI, MockWhatsApp e MockStorage, sem credenciais ou envio externo; bloqueio de modo de produção.
- Documentação de arquitetura, operação e testes. Especificação original preservada em `docs/SPEC.md`.
- Etapas 1–5 permanecem futuras; não há compra, aprovação financeira, pagamento, venda ou conexão Meta ativa.

As versões do software e da especificação são independentes. A versão 1.0 abaixo identifica o documento original, não uma versão do sistema já implementada.

## 1.0 — 2026-11-17
- Consolidação de todas as solicitações de central de compras WhatsApp, cotações, prazos, preços-base/tetos, urgências, Pix, cheques, entregas, quantitativos, vendas parceladas e fluxo de caixa.
- Aprovação de cada compra restrita ao proprietário; reaprovação de teto exigida apenas para preço superior ao teto anterior.
- Conciliação inicial manual; fase posterior de OFX/CSV e futura integração bancária.
- Fechamento contábil mensal, notas fiscais pendentes e pacote para contador.
- Desenvolvimento por Codex ou Claude Code, primeiro em DRY_RUN, preparado para SaaS.

### Verificação final — 18/11/2026

- 42 testes aprovados; compilação, lint e demonstração executável aprovados.
- Revisão visual desktop: pedido, convites, deduplicação, importação, congelamento e cadastro.
- Corrigidos limites de especificação, múltiplos materiais, total agregado, tamanho de CSV e criação do diretório persistente.
