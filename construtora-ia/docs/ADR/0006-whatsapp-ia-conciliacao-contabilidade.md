# ADR 0006 — WhatsApp Cloud API, IA, extratos, notas fiscais e fechamento contábil (Etapa 4)

Data: 2026-11-18. Estado: adotada. **Os adaptadores externos foram verificados apenas contra respostas simuladas; nenhuma chamada a Meta, Anthropic, STT ou SMTP reais foi feita.**

## WhatsApp
1. **Webhook** `/webhook/whatsapp`: `GET` responde o desafio com `META_VERIFY_TOKEN`; `POST` exige `X-Hub-Signature-256` (HMAC-SHA256 do corpo bruto com `META_APP_SECRET`, comparação em tempo constante). Sem segredo configurado nenhuma origem é aceita. A empresa é resolvida por `phone_number_id` → `whatsapp_accounts`. Eventos duplicados são descartados por `whatsapp_inbound(tenant, wamid)`; falhas ficam `FAILED` e podem ser reprocessadas.
2. **Identificação:** o remetente é identificado por telefone cadastrado (proprietário, encarregado, escritório ou fornecedor). Desconhecidos são ignorados e auditados. Telefone **não** é fator suficiente para ações críticas.
3. **Execução pelas mesmas rotas:** as mensagens são traduzidas em chamadas internas às **mesmas rotas HTTP** do painel, com sessão efêmera de 60 s — portanto passam pelas mesmas validações, permissões e gatilhos de banco. A IA nunca contorna regras. Fornecedores só alcançam: proposta, resposta a pedido, chave Pix (pendente) e promoção; nunca aprovação ou baixa.
4. **Aprovação do proprietário por WhatsApp:** `APROVAR` sozinho apenas lista pedidos. `APROVAR 0003` devolve o resumo e um **código HMAC** ligado a pedido+versão+hash; só `APROVAR 0003 CÓDIGO` (e `TETO` quando o preço excede o teto) aprova. Mudou a versão ⇒ o código antigo não vale. 5 erros ⇒ bloqueio de 15 min (em memória). Aprovar pelo painel continua disponível.
5. **Consultas** do proprietário/escritório (receber no mês, cheques do mês seguinte, caixa 30/60/90, custo restante, pendências) respondem com números calculados pelo banco, rotulando previsto × confirmado.
6. **Fila de saída:** em modo real (`app.live=on`, um gatilho transforma `SENT_SIMULATED` em `QUEUED` e retira o prefixo de simulação) o despachante envia respeitando a **janela de 24 h**; fora dela só com template aprovado (`WHATSAPP_GENERIC_TEMPLATE`), senão `BLOCKED_WINDOW` + aviso. Falhas retentáveis (5xx/429) têm recuo exponencial; após 5 tentativas ou erro definitivo ⇒ `DEAD_LETTER` + alerta; reenfileiramento manual. Status `sent/delivered/read/failed` da Meta atualizam as mensagens.
7. **Mídia/áudio:** fotos/PDF são baixados (≤ 5 MB), tipo verificado pelo conteúdo e guardados como anexo; áudio é transcrito por `SttClient` (endpoint compatível com `/audio/transcriptions`) e segue o fluxo do texto; sem STT pede texto.

## IA
`AIProvider` (`MockAIProvider` por padrão; `ClaudeAI` com `ANTHROPIC_API_KEY`). Conteúdo é tratado como **dado não confiável** (prompt de sistema, saída JSON validada por esquema Zod). A extração do pedido é **validada contra o catálogo, a unidade e a data**; qualquer falha cai para as regras determinísticas, que pedem esclarecimento. Leitura de nota e comprovante só sugere campos; o registro segue as regras e a conferência humana.

## Extratos e conciliação
OFX e CSV; arquivo repetido (hash) ⇒ `DUPLICATE_IMPORT`; linhas com FITID único por conta, sem FITID com hash+sequência (reimportar em outro arquivo não duplica; sobreposição gera alerta). `matchLine` só **sugere** com valor idêntico + data na janela + evidência de contraparte + candidato único; mesmo valor sem isso ⇒ `REVIEW`. A conciliação é sempre **confirmada pelo proprietário** (individual ou em lote das sugestões seguras): obrigação → `RECONCILED`; entrada → recebimento (método `EXTRATO`) da parcela. Linhas e vínculos são imutáveis.

## Notas fiscais e contabilidade
NF-e XML (chave 44 dígitos com DV, sem DTD/entidades, ≤ 3 MB). Vínculo por pedido explícito ou emitente(CNPJ)+valor únicos; divergência de valor/emitente ⇒ `DIVERGENT` + alerta; a mesma chave nunca duplica (índice único). **Fechamento:** `check` lista pedidos confirmados da competência sem nota; `request-missing` cobra **só** os pendentes (uma vez por pedido/competência, apenas documentação de operação já realizada); `package` gera ZIP por empresa/obra/competência (CSV de compras, pagamentos, recebimentos, notas, extrato, pendências, XML/PDF) em rascunho; envio ao contador só após **aprovação**; e-mail real somente com SMTP configurado e modo real, senão simulado e registrado.

## Promoções
Informativas: o texto do fornecedor vira `promotions` com economia potencial (preço normal = último pedido confirmado × quantidade ainda por comprar). Nunca gera compra. Consulta semanal aos fornecedores é **opt-in** da empresa.

## Segurança
`WHATSAPP_LIVE=true` é recusado enquanto o painel usar o login de desenvolvimento (autenticação real: Etapa 5).
