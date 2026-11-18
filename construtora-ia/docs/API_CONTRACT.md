# Contrato interno (Etapas 0 e 1)

JSON, erros `{error:string}`, sucesso direto. Bearer token dev em todas as rotas exceto health/login/tenants. Identidade/tenant vêm da sessão, nunca do corpo. IDs UUID.

- GET /api/health → {dryRun:true,...}
- GET /api/dev/tenants → Tenant[]
- POST /api/dev/login {tenantId,role} → Session
- GET /api/state → State (packages/shared/src/index.ts)
- POST /api/worksites {name,address,legalEntityName} → Worksite
- POST /api/suppliers {name,phone,categories:string[],leadDays,consent,active} → Supplier
- POST /api/materials {name,unit,category,aliases:string[]} → Material
- POST /api/budgets {worksiteId,items:[{materialId,quantity:string,unitPrice:string}]} → Budget (novo DRAFT, versão incremental)
- POST /api/budgets/:id/freeze {} → Budget (FROZEN imutável)
- POST /api/imports/preview {worksiteId,csv,mapping?:ColumnMapping} → ImportPreview (mapeamento padrão material,unidade,quantidade,preco_unitario)
- POST /api/imports/commit {worksiteId,csv,mapping?,confirmed:true} → Budget (revalidar servidor, criar rascunho; congelar separado)
- POST /api/simulator/messages {providerMessageId,worksiteId,sender:string (telefone autorizado),text,kind:'text'|'audio_transcript'} → {request:MaterialRequest,duplicate:boolean}
- POST /api/requests/:id/clarify {materialId,quantity,requiredDate} → MaterialRequest
- POST /api/requests/:id/quote {} → {request:MaterialRequest,invitations:number,duplicate:boolean}
- GET /api/budgets/:id/export → text/csv

Rotas de cadastro, orçamento/importação: owner. Simular: owner ou site_requester no próprio telefone/obra. Consultas requester limitadas às suas obras, sem orçamento/fornecedores/auditoria, mensagens somente próprias. Escritório só leitura. RFQs são convites simulados; não criar ofertas/preços/ordens/compra. Caso ambíguo pede esclarecimento e não cria convite.

Domain exports: extractRequest(text,materials,now?:Date):Extraction; previewBudgetCsv(csv,materials,mapping?):ImportPreview; budgetItems(items):BudgetItem[]; moneyTotal(items):string. Integrações: MockAI.extract(text,materials,now?), MockWhatsApp.composeRFQ({requestId,material,quantity,worksite,requiredDate,deadline}):string; MockStorage.put/get tenant-scoped. Sem envio externo.

Seed: 2 tenants (principal com obra Residencial Aurora, 5 fornecedores, 10 materiais, base congelada e rascunho opcional); contatos fictícios owner/requester. Todos nomes e dados fictícios. Front pode selecionar contatos retornados. Backend exporta createApp({dataDir?:string,seed?:boolean}={}) → Promise<{app,db,close}> para testes; dataDir omitido usa memória, server passa caminho persistente. Não auto iniciar servidor ao importar app.


## Etapa 1 — compras e aprovações (owner, salvo indicação; escritório lê; encarregado não acessa)

Erros de regra de negócio trazem `{error, code}`. Valores monetários são strings decimais.

- POST /api/requests/:id/quotes {supplierId, providerMessageId, text?, unitPrice?, freight?, otherCosts?, leadDays?, paymentTerms?, brand?, availableQuantity?, specConfirmed?, unavailable?} → 201 {quote, comparison, duplicate}. Só fornecedores convidados; solicitação em QUOTING/QUOTED; sem pedido ativo. Nova resposta do mesmo fornecedor cria versão e substitui a anterior (preservada). Idempotente por (fornecedor, providerMessageId); mesmo ID com conteúdo diferente → 409.
- POST /api/requests/:id/close-quoting {} → {request, comparison, duplicate}. 409 `NO_COMPARABLE_QUOTES` se nada é comparável. Convites sem resposta ficam `NO_RESPONSE`.
- GET /api/requests/:id/comparison → Comparison (owner/escritório).
- POST /api/requests/:id/orders {quoteId, acknowledgeLateDelivery?, acknowledgeLimitedComparison?, urgentJustification?} → 201 PurchaseOrder em `PENDING_OWNER_APPROVAL`. Códigos: `ACTIVE_ORDER_EXISTS`, `QUOTE_NOT_COMPARABLE`, `LATE_DELIVERY_ACK_REQUIRED`, `LIMITED_COMPARISON_ACK_REQUIRED`, `JUSTIFICATION_REQUIRED` (400).
- POST /api/purchase-orders/:id/approve {version, hash, approvePriceCap?} → {order, approval, duplicate}. Códigos: `PRICE_CAP_APPROVAL_REQUIRED`, `STALE_ORDER`, `NOT_PENDING`, `EXPIRED`.
- POST /api/purchase-orders/:id/reject {reason} · POST …/cancel {reason} · POST …/supplier-timeout {}
- POST /api/purchase-orders/:id/supplier-response {providerMessageId, action:'CONFIRM'|'CHANGE'|'UNAVAILABLE', confirmsSameTerms?, unitPrice?, quantity?, freight?, otherCosts?, leadDays?, paymentTerms?}. `CONFIRM` exige `confirmsSameTerms:true`; qualquer termo diferente reabre a aprovação (v+1).
- `GET /api/state` passa a incluir `quotes, comparisons, orders, approvals, priceAuthorizations, deviations, priceControl` (vazios para encarregado).
- `GET /api/health` → `stage: 1`.
