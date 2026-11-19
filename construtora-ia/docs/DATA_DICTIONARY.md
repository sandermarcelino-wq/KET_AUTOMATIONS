# Dicionário de dados — Etapa 0

O esquema SQL executável está em `packages/database/migrations/`. Este documento descreve os conceitos e os DTOs usados pela API; os nomes físicos das tabelas e suas constraints devem ser consultados nas migrações. O modelo completo da seção 14 da especificação será acrescentado por etapa, não por tabelas vazias que aparentem funcionalidades prontas.

## Armazenamento físico

`001_initial.sql` cria `tenants`, `worksites`, `suppliers`, `materials`, `contacts`, `budgets`, `requests`, `messages`, `quote_invitations`, `audit_events` e `idempotency_keys`. IDs, tenant e relações críticas são colunas relacionais com chaves compostas; os DTOs ficam em `data jsonb`. O orçamento possui versão e total `numeric(18,2)` gerados, além de trigger que confere os valores decimais dos itens, somas, duplicações e tenant de cada material. Outra trigger preserva a versão congelada, e a auditoria bloqueia alteração e exclusão.

`002_row_level_security.sql` cria o papel `construtora_app`, sem `BYPASSRLS`, e políticas por `app.tenant_id`. O servidor deve usar esse papel e fixar o tenant dentro de cada transação autenticada. A conexão administrativa usada em migrações e seed não pode ser oferecida ao navegador. O login de demonstração continua sendo uma escolha de identidade fictícia, sem comprovar quem é a pessoa.

## Contratos da API

| Conceito / DTO | Campos principais e significado |
|---|---|
| `Tenant` | `id`, `name`: organização isolada |
| `Session` | `token`, `tenant`, `role`, `userName`: sessão de demonstração escolhida no login |
| `Worksite` | `id`, `name`, `address`, `legalEntityName`: obra e entidade identificada |
| `Supplier` | `name`, `phone` E.164, `categories`, `leadDays`, `consent`, `active`: elegibilidade inicial para convite |
| `Material` | `name`, `unit`, `category`, `aliases`: produto e unidade comercial sem conversão implícita |
| `Contact` | `name`, `phone`, `worksiteIds`, `role`: identidade fictícia e obras permitidas |
| `Budget` | `worksiteId`, `version`, `status`, `items`, `total`, `createdAt`, `frozenAt`: referência versionada |
| `BudgetItem` | `materialId`, `quantity`, `unitPrice`, `total`: quantidade e preço-base decimal |
| `MaterialRequest` | `worksiteId`, `contactId`, `originalText`, `kind`, `materialId`, `quantity`, `requiredDate`, `status`, `clarification`, `urgent`, `invitationCount` |
| `Message` | `requestId`, `direction`, `recipient`, `text`, `status`, `providerMessageId`, `createdAt`: comunicação exclusivamente simulada |
| `SupplierQuote` | `requestId`, `supplierId`, `version`, `unitPrice`, `freight`, `otherCosts`, `leadDays`, `paymentTerms`, `availableQuantity`, `specConfirmed`, `unavailable`, `status`, `missing`, `rawText`: resposta simulada; originais preservadas |
| `PurchaseOrder` | `number`, `version`, `hash`, `status`, `terms`, `baselineUnitPrice`, `needsPriceApproval`, `urgency`, `expiresAt`, `history`: pedido preparado/aprovável |
| `PurchaseApproval` | `orderId`, `orderVersion`, `orderHash`, `status` (`VALID`/`INVALIDATED`), `approvedBy`, `priceCapApproved`: aprovação do proprietário ligada à versão |
| `PriceAuthorization` | `worksiteId`, `materialId`, `paymentTerms`, `previousCap`, `cap`, `status` (`ACTIVE`/`SUPERSEDED`), `approvedBy`: histórico do teto |
| `Deviation` / `PriceControlRow` | Painel derivado: base × cotado/comprado × teto, impacto = (preço − base) × quantidade |
| `AuditEvent` | `action`, `entityId`, `actor`, `createdAt`: registro da ação sensível |
| `ImportPreview` | `rows`, `errors`, `total`, `valid`: revisão antes da escrita do orçamento |

## Estados

- Orçamento: `DRAFT` → `FROZEN`. A versão congelada é histórica; retificação cria outra versão.
- Solicitação: `NEEDS_CLARIFICATION` → `READY_TO_QUOTE` → `QUOTING` → `QUOTED` → `SUBMITTED_FOR_APPROVAL` → `ORDERED`. `QUOTING` indica convites locais gerados; propostas chegam pelo simulador; `ORDERED` significa pedido aprovado e enviado (simulado) ao fornecedor.
- Proposta: `COMPARABLE`, `NEEDS_CLARIFICATION` (componente ausente), `UNAVAILABLE`, `SUPERSEDED` (versão anterior).
- Pedido: `PENDING_OWNER_APPROVAL` → `WAITING_SUPPLIER_CONFIRMATION` → `CONFIRMED`; também `SUPPLIER_UNCONFIRMED`, `REJECTED`, `CANCELLED`, `EXPIRED`, `SUPPLIER_UNAVAILABLE`. `CONFIRMED` não significa faturado, entregue ou pago.
- Mensagem: `RECEIVED_SIMULATED` ou `SENT_SIMULATED`. Nenhum desses estados é recibo da Meta.
- Origem do pedido: `text` ou `audio_transcript`. A segunda opção contém texto informado por uma pessoa.

## Tipos e regras transversais

IDs são UUIDs. O servidor recebe o tenant da sessão e aplica esse contexto a cada consulta/mutação. Valores monetários e quantidades no JSON são strings decimais; não se deve converter preços para `number` para executar cálculos de domínio. Datas de evento são armazenadas em UTC. Datas desejadas de entrega são datas civis, sem presumir confirmação de fornecedor.

O identificador da mensagem deve ser estável por evento e organização/conta simulada. A mesma chave com conteúdo diferente é conflito, não atualização. Referências devem apontar a entidades do mesmo tenant.

Teto autorizado, propostas, pedidos e aprovações passaram a existir na Etapa 1 (ver ADR 0003). Compras comprometidas no orçamento (quantidade comprada/recebida), contas a pagar/receber, Pix, cheques, notas fiscais e conciliação continuam fora dos DTOs ativos.


## Etapas 2–5 (resumo)
Tabelas novas (migrações 003–008): `supplier_quotes`, `price_authorizations`, `purchase_orders`, `purchase_approvals`, `attachments`, `deliveries`, `supplier_pix_keys`, `payment_obligations`, `payment_proofs`, `notifications`, `tenant_settings`, `property_units`, `buyers`, `sales_contracts`, `contract_versions`, `receivable_installments`, `receipts`, `bank_accounts`, `cash_entries`, `whatsapp_accounts`, `whatsapp_inbound`, `fiscal_documents`, `bank_statement_imports`, `bank_statement_lines`, `bank_matches`, `accountant_contacts`, `missing_document_requests`, `accounting_packages`, `outbound_emails`, `promotions`, `users`, `auth_sessions`, `tenant_plans`, `usage_counters`, `workers` (equipe de mão de obra; pagamentos em `cash_entries` com `workerId`/`attachmentId`). Estados: pedido (`PENDING_OWNER_APPROVAL → … → RECEIVED`), obrigação (`SCHEDULED/DUE/REPORTED/CONFIRMED/RECONCILED/OVERDUE`), parcela (`SCHEDULED/DUE/PARTIALLY_PAID/PAID/OVERDUE/RENEGOTIATED/CANCELLED`), mensagem (`QUEUED/SENT/DELIVERED/READ/FAILED/DEAD_LETTER/BLOCKED_WINDOW`). Integridade crítica por gatilhos (aprovação válida, históricos imutáveis, somas) e RLS por empresa em todas as tabelas.
