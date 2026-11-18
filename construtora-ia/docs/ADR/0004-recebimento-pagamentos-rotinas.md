# ADR 0004 — Recebimento documental, Pix, cheques, rotinas e configurações (Etapa 2)

Data: 2026-11-18. Estado: adotada.

1. **Recebimento documental ≠ vistoria ≠ custo.** `POST /api/deliveries` registra nota/romaneio (foto/PDF opcional guardada como anexo privado, tipo verificado pelo conteúdo). Sem número de pedido e com mais de um candidato → `NEEDS_ORDER_ID` (não se presume). Quantidade acumulada: menor → `PARTIALLY_RECEIVED` (fornecedor avisado do saldo); igual → `RECEIVED`; maior → entrega `DIVERGENT` (não conta até decisão do proprietário). Documento repetido (mesmo nº ou mesmo arquivo) não duplica. Receber não altera o custo comprometido.
2. **Obrigações de pagamento** (`payment_obligations`) formam o cronograma de um pedido já confirmado; a soma deve igualar o total do pedido (validado na API e por gatilho). 10 cheques de R$ 1.000 = custo R$ 10.000 + agenda R$ 10.000. Cheque único por banco+número. `CONFIRMED/RECONCILED/CANCELLED` são terminais; exclusão proibida.
3. **Pix:** `supplier_pix_keys` com validação de CPF/CNPJ/e-mail/telefone/UUID. Chave informada pelo fornecedor nasce `PENDING_VERIFICATION` e alerta o proprietário; só o proprietário verifica (“por outro canal”) e há no máximo uma chave verificada por fornecedor. Sem chave verificada: `PAYEE_VERIFICATION_REQUIRED`. O pedido de pagamento vai ao WhatsApp do proprietário em **duas mensagens**: dados do pedido, depois a chave isolada. Titular com documento diferente do CNPJ do fornecedor exige aceite explícito.
4. **Comprovante:** gera `REPORTED` (nunca `CONFIRMED`); valor/favorecido divergentes ficam `DIVERGENT` e exigem aceite expresso na confirmação; repetição por ID de transação ou por hash de arquivo é idempotente. Confirmação manual (`PAYMENT_CONFIRMED_MANUALLY`) é do proprietário e exige nota; o banco verifica que `confirmedBy` é `owner`.
5. **Rotinas** (`jobs.ts`, `POST /api/jobs/run` e agendador do servidor a cada `JOBS_INTERVAL_MINUTES`, padrão 30): marca vencimentos, avisa D-7 (resumo), D-2 e D0 (imediato), vencidas, entregas atrasadas (proprietário + lembrete ao encarregado), aprovações expiradas, encerra cotações no prazo com as propostas disponíveis e consolida avisos de baixa prioridade em um resumo. Todas deduplicadas por `notifications.dedupe_key`.
6. **Configurações por empresa** (`tenant_settings`): propostas mínimas, validade da aprovação, prazo de cotação, dias de aviso, limite de desvio, auto-encerramento, inclusão de vencidas na projeção. Padrões no código, alteráveis só pelo proprietário.
7. **Acompanhamento de custos** (`budgetTracking`): orçado (última versão congelada) × comprometido × recebido × pago × informado × a pagar × falta comprar × custo restante estimado (último preço comprado, senão base) × desvio %. Comprado não é tratado como consumido.
8. **Cadastro de fornecedor completo**: CNPJ validado, contato, localização, formas de pagamento, condições, materiais específicos (restringem os convites quando preenchidos), edição por `PATCH`.

## Limites
- O recebimento por foto não faz OCR: a pessoa informa nº e quantidade; a leitura automática por IA entra na Etapa 4 (adaptador com validação por regras).
- A confirmação do pagamento é manual até a importação de extrato (Etapa 4).
- Notificações são mensagens simuladas até a integração oficial do WhatsApp.
