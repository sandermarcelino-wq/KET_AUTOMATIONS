# CONSTRUTORA IA
## Especificação funcional, técnica e plano de desenvolvimento

**Versão:** 1.0 consolidada  |  **Data-base:** 17/11/2026  |  **Idioma do produto:** português brasileiro  
**Objetivo:** criar primeiro uma solução para uso próprio e depois transformá-la em SaaS para construtoras e proprietários que administram a própria obra.  
**Agentes de desenvolvimento:** OpenAI Codex ou Anthropic Claude Code. **Este arquivo é a fonte única de requisitos; decisões posteriores devem gerar uma nova versão, sem apagar o histórico.**

> **Instrução ao agente de programação:** este documento descreve o produto a implementar, não significa que o sistema já exista. Não simule integração real como se estivesse ativa. Desenvolva em etapas, primeiro com fornecedores, banco e mensagens simulados; conecte a Meta/WhatsApp e quaisquer serviços externos somente depois da configuração explícita. Não efetue compras, pagamentos ou envios reais sem testes e autorização. Havendo lacuna, adote a alternativa conservadora, documente a hipótese e mantenha o parâmetro configurável.

---

# 1. Visão do produto

O sistema é uma **central inteligente de compras, orçamento, contas a pagar, contas a receber, fluxo de caixa e fechamento documental/contábil de obras**, operada principalmente pelo WhatsApp. O pedreiro pede materiais em linguagem natural; a IA consulta fornecedores cadastrados, compara cotações, informa prazos, encaminha decisões ao proprietário, documenta pedido e recebimento e registra custos e compromissos. Em paralelo, a empresa cadastra apartamentos vendidos, entradas e parcelas contratuais, cruzando receitas previstas/recebidas com obrigações e desembolsos. No fim do mês, organiza os documentos do contador.

**Princípio de experiência:** pedreiro e vendedor de loja não precisam aprender aplicativos, menus ou formulários. Falam pelo WhatsApp, enviam áudios, textos ou fotografias. O proprietário recebe alertas apenas quando existe ação ou decisão relevante, com informações suficientes para resolver em poucas mensagens. Um pequeno painel web fica reservado ao cadastro, administração e revisão; não substitui o WhatsApp.

**Princípio de segurança:** IA entende mensagens e extrai dados; **regras determinísticas, com validações no servidor e banco, decidem o que pode ser gravado ou enviado**. O modelo não movimenta dinheiro e não autoriza compras por conta própria.

# 2. Decisões definitivas e interpretações

| Tema | Regra aprovada |
|---|---|
| Autoridade | **Somente o proprietário** aprova compras e exceções. Outros contatos podem solicitar, cotar, confirmar recebimento e fornecer comprovantes, mas não aprovar gastos. |
| Compras | Na primeira versão, **cada pedido de compra exige autorização do proprietário**, inclusive quando o preço está dentro do teto. A aprovação do *aumento de preço* é uma decisão distinta. Ambas podem ser apresentadas em uma única mensagem quando cabível. |
| Orçamento-base | Preços e quantitativos anteriores à obra são imutáveis como referência histórica; retificações exigem versão e trilha de auditoria. |
| Teto autorizado | Um aumento unitário autorizado estabelece novo teto válido para condição equivalente; pedidos futuros até esse teto **não exigem nova autorização do reajuste**. Aumentos superiores exigem nova autorização de preço. Ex.: base R$ 30; aprovado R$ 32; cotação de R$ 32 não exige novo aceite do preço; R$ 33 exige. |
| Visibilidade de aumento | Mesmo após aprovação do novo teto, relatórios mostram o desvio cumulativo frente à base original e o impacto no saldo de materiais. Evitar alertas idênticos repetitivos; consolidar por evento e período. |
| Prazos | Prazo por fornecedor/material: p.ex. cimento dois dias; atacado externo sete a dez dias. Pedreiro recebe orientação e confirmação da data viável. |
| Urgências | Solicitação fora do prazo ou com ágio/prazo incompatível é levada ao proprietário com diferença de custo e alternativas. |
| Pix | O proprietário paga manualmente no banco. A central envia pedido, valor, beneficiário e **chave Pix em mensagem separada** para copiar. Chave nova ou alterada exige validação independente. |
| Comprovantes | O usuário encaminha comprovante para loja e central. A central cruza documento com pedido, mas comprovante recebido **não equivale automaticamente a transação conciliada**. |
| Cheques | Cadastrar cada cheque pré-datado, valor, data combinada, identificador, status; avisar antes do vencimento. Cheques podem ser apresentados antes da data combinada. |
| Recebimento | Pedreiro autorizado fotografa romaneio/nota de entrega assinada; sistema vincula ao pedido e identifica quantidade; divergências passam por revisão. |
| Estoque | **Fora do escopo inicial:** baixa física detalhada, inventário automático, medição de produtividade e consumo real. Só controlar pedido, compra, entrega documental, quantidade acumulada e orçamento. |
| Contratos de apartamentos | Entrada e parcelas; correção, juros, reajuste e encargos **variam por contrato**. Não assumir taxa ou índice uniforme. |
| Confirmação financeira | **Primeira fase: conferência manual** de pagamentos e recebimentos. Segunda fase: importação de extratos OFX/CSV; terceira: integração bancária somente leitura. |
| Dados legados | Estão **misturados entre planilhas e documentos**; criar importação assistida com pré-visualização, mapeamento e validação humana. |
| Contabilidade | Fechamento mensal documental enviado ao contador, sem tentar substituir escrituração fiscal ou profissional habilitado. |
| Tecnologia | Preferir código próprio desenvolvido com Codex ou Claude Code, sem dependência obrigatória de n8n; serviços gratuitos ou de baixo custo **quando confiáveis e dentro dos limites**. |
| Comercialização | Isolamento entre clientes/empresas/obras desde o início; permitir futuro SaaS. |

**Resolução de aparente conflito:** “só eu autorizo compras” refere-se à **aprovação da transação**; “não pedir repetidamente autorização do aumento até R$ 32” refere-se **somente ao teto de preço**. No MVP, compras continuam submetidas ao proprietário. Essa separação deve ser explícita no código e na interface.

# 3. Escopo e exclusões

## 3.1 Incluído

1. Cadastro de organizações, entidades jurídicas, obras, usuários autorizados, fornecedores, contatos e categorias de produtos.
2. Cadastro/importação de materiais, unidades, equivalências, quantitativos e valores orçados; congelamento da versão inicial.
3. Entrada por WhatsApp de pedidos em texto, áudio e imagem; solicitação de informações faltantes.
4. Regras de prazo/antecedência, alternativas urgentes e alertas.
5. RFQ: cotações individuais de múltiplas lojas, com hora-limite, preço, frete, impostos quando aplicável, disponibilidade, marca/modelo e condições de pagamento.
6. Comparação de ofertas tecnicamente equivalentes e escolha da opção de menor custo total **dentro dos requisitos de entrega**; cotação por lote ou por item configurável.
7. Aprovação de compra exclusiva do proprietário, aprovação de mudança de teto, registro das decisões e histórico.
8. Pedido ao fornecedor com preço e prazo claros; confirmação inequívoca antes de tratar como compra contratada.
9. Solicitação de chave Pix, alerta de pagamento manual, upload/vínculo de comprovantes; rastreamento de pagamento informado vs. conciliado.
10. Compras parceladas/cheques, vencimentos e alertas; contas a pagar.
11. Recebimento por foto de comprovante assinado; controle documental de itens entregues, entregas parciais, faltas e divergências.
12. Cadastro de apartamentos/unidades, compradores, contratos, entradas, planos de parcelas, pagamentos, atrasos, correções contratuais; contas a receber.
13. Fluxo de caixa previsto e realizado, por entidade e obra, com períodos 7/30/60/90 dias e cenário prudente.
14. Importação posterior de extratos bancários, conciliação semi-automática; integração bancária como fase futura.
15. Fechamento mensal: notas XML/PDF pendentes, recibos, movimentações, extratos, relatórios e envio organizado ao contador.
16. Consultas e notificações pelo WhatsApp e painel web mínimo de administração.
17. Log imutável de ações sensíveis; relatórios exportáveis e separação multiempresa desde o início.

## 3.2 Excluído nesta fase

- Controle de estoque físico em tempo real, inventário automático, rastreio de perdas/roubo, apontamento diário de produção e medição automática da execução.
- Banco executar Pix, iniciar transferências, assinar cheques, criar conta bancária ou liberar pagamentos.
- Cálculos de engenharia, elaboração/substituição de ART/RRT e responsabilidade técnica.
- Escrituração fiscal automática como substituto do contador; cálculo automático de tributos sem parâmetros homologados.
- Estratégias de preços de venda automáticas; o sistema apenas calcula impactos e recomenda avaliação humana.
- Marketplace público de fornecedores e compras entre clientes do SaaS (futuro).

# 4. Perfis, permissões e atendimento

**Proprietário:** perfil `owner`: aprovar/rejeitar compras e tetos, validar Pix, conferir pagamentos, editar parâmetros, solicitar relatórios, validar fechamento. Sua identidade é vinculada a números autorizados; uma ação crítica exige um identificador de pedido e confirmação consciente.

**Pedreiro/encarregado:** perfil `site_requester`: solicitar e acompanhar pedidos da(s) obra(s) autorizada(s), indicar data desejada, receber aviso de prazo e fotografar comprovantes de entrega. Não vê outros empreendimentos ou informações bancárias.

**Fornecedor:** perfil externo `supplier_contact`: receber cotação, responder preço/prazo/condição, confirmar disponibilidade, enviar dados de cobrança e documentos fiscais. Não recebe ofertas concorrentes nem dados confidenciais.

**Escritório:** papel `operator_readonly` no início; pode cadastrar documentos se delegado, mas **não autoriza compras**. Qualquer mudança futura de permissão exige decisão explícita do proprietário.

**Contador:** recebe um pacote aprovado por competência, podendo futuramente ter acesso restrito a pasta/portal, sem permissão para alterar lançamentos.

**WhatsApp:** um número comercial central, conversas individuais e identificadas; não depender de grupos. Cadastro de telefone E.164, verificação/consentimento de fornecedores, controle de janela de atendimento e templates aprovados quando necessários. Não presumir que todo fornecedor aceita mensagens proativas.

# 5. Jornada completa de compra

## 5.1 Pedido do pedreiro

Exemplo: áudio “preciso de 100 sacos de cimento CP II, de 50 kg, na obra A, daqui dois dias”.

1. Webhook recebe mensagem, verifica assinatura e deduplica ID do evento.
2. Identifica número e obras permitidas; guarda mídia em armazenamento privado.
3. Processa áudio, texto ou foto via serviço de IA; retorna dados estruturados com confiança.
4. Normaliza material (ex.: cimento CP II 50 kg), unidade, quantidade e data. Se ambíguo, faz **uma pergunta curta de esclarecimento**.
5. Consulta antecedência mínima dos fornecedores elegíveis; informa ao solicitante data realista. Se prazo pedido estiver fora das condições usuais, marca `urgent=true` e pede decisão do proprietário quando houver sobrepreço/risco.
6. Salva uma solicitação (`material_request`) em estado `READY_TO_QUOTE`, sem gerar compra automaticamente.

## 5.2 Cotação entre lojas

1. Seleciona fornecedores ativos por categoria, região de entrega, especificação, prazo e consentimento para contato.
2. Envia mensagens individualizadas com **ID da cotação, especificação, quantidade, obra/local de entrega, prazo, condições exigidas, horário-limite**. Aplicar janela/template oficial da Meta.
3. Recebe respostas (livres ou documentos), interpreta e solicita esclarecimento quando falta preço, frete ou prazo.
4. Salva todas as propostas originais e a interpretação estruturada; fornecedor não precisa preencher formulário.
5. Aguarda o prazo-limite configurado. Para urgências, janela reduzida mediante autorização e número mínimo de cotações tentadas; se não houver propostas suficientes, declarar limitação, não inventar preço.
6. Calcula total comparável: quantidade × preço unitário + frete + impostos/custos não recuperáveis aplicáveis e conhecidos + serviços obrigatórios. Se faltar componente, tratar proposta como **incomparável** até esclarecer.
7. Aplica critérios de especificação, marca equivalente autorizada, disponibilidade, prazo, crédito, condição de pagamento e eventuais lotes mínimos.
8. Exibe vencedor sugerido, número de propostas recebidas, economia vs. segunda oferta e **aumento vs. orçamento-base / teto autorizado**.
9. Nunca compartilhar preço de concorrente com fornecedor.

**Regra de menor preço:** escolher a menor oferta **que cumpra especificação e prazo**; se a opção mais barata falhar no prazo, listar alternativa urgente e custo incremental. Pedido com vários itens pode ser agrupado para reduzir frete; se dividido entre lojas, registrar pedidos separados com vínculo a uma solicitação.

## 5.3 Duas autorizações separadas

- **Teto de preço:** `price_authorizations` registra teto unitário normalizado, material, condições comparáveis, escopo, data, aprovador e auditoria. Exemplo: orçamento-base = R$ 30/saco; teto atual = R$ 30; oferta R$ 32 exige `APPROVE_PRICE_CAP`; depois teto = R$ 32; nova oferta R$ 32 não exige novo aceite do **preço**; oferta R$ 33 exige novo teto.
- **Pedido de compra:** `purchase_approvals` exige `APPROVE_PURCHASE` para todo pedido no MVP, sempre pelo proprietário, informando preço total, loja e prazo. Duas aprovações podem aparecer em um único cartão de ação com confirmação explícita de ambas.
- Toda cotação acima do preço-base histórico integra o **painel de desvios**, mesmo se dentro do teto atual. Evitar mandar o mesmo alerta repetidamente por uma oferta de preço já aprovada.
- **Critério de comparação do teto:** produto/unidade/especificação + condição de entrega e pagamento. Não reutilizar teto para outra marca/qualidade ou frete excluído; configurar se teto é por fornecedor ou global para a obra. Padrão seguro: por obra+material+condição de pagamento; frete compare em custo total à parte.
- Se preço, quantidade, prazo, frete ou produto mudarem **após aprovação**, invalidar confirmação anterior e reabrir a aprovação pertinente.

## 5.4 Fechamento com fornecedor

Após aprovação do proprietário, mandar algo equivalente a:

> Pedido 001: solicitamos 100 sacos de cimento CP II 50 kg, valor total R$ X incluindo frete, entrega até DD/MM, na obra Y. **Não fature nem despache se alterar preço, item, quantidade, frete ou prazo; informe antes de prosseguir.** Confirme expressamente disponibilidade e manutenção de preço. Se pagamento antecipado, informe condição de faturamento e chave Pix do beneficiário previamente cadastrado ou para validação.

Distinção de estados:
- Mensagem enviada ≠ entregue ≠ lida ≠ fornecedor confirmou ≠ pedido faturado.
- Mensagem da loja “tem sim” sem preço e prazo não é confirmação suficiente.
- Se fornecedor não confirmar no prazo, remarcar `SUPPLIER_UNCONFIRMED`, notificar e solicitar alternativa; não duplicar compras.

## 5.5 Pix e compras à vista

1. Loja solicita pagamento; central obtém nome/razão social, CPF/CNPJ do beneficiário, chave Pix, valor e pedido.
2. Se chave inexistente ou alterada, marcar `PAYEE_VERIFICATION_REQUIRED`; pedir verificação humana fora da própria mensagem do fornecedor. Não adotar automaticamente novas chaves.
3. Enviar ao WhatsApp particular do proprietário: **pedido, obra, fornecedor, valor, favorecido, prazo**. Em **outra mensagem**: chave Pix isolada, sem conteúdo extra, para copiar.
4. Proprietário realiza Pix manualmente no banco e envia comprovante à central e à loja.
5. Sistema extrai valor, data, identificadores e favorecido quando presentes; compara com obrigação e marca `PAYMENT_REPORTED_PENDING_VERIFICATION`.
6. **Fase 1:** proprietário confere manualmente e marca `PAYMENT_CONFIRMED_MANUALLY` com auditoria. **Fase 2:** importa extrato e concilia. **Fase 3:** consulta bancária automatizada somente leitura.
7. Fornecedor confirma recebimento e processamento; iniciar acompanhamento de nota e entrega. Comprovante visual sozinho não autoriza supor pagamento liquidado.
8. Se comprador enviar dois comprovantes para a mesma obrigação, não duplicar baixa; idempotência por pedido, identificador da transação e revisão manual.

## 5.6 Compras com cheque e parcelamento

Exemplo: material R$ 10.000 em 10 cheques de R$ 1.000.

- Gerar `purchase_order` de R$ 10.000 e **10 obrigações** com datas combinadas, valor, banco, identificador do cheque, fornecedor e status. O custo da compra é R$ 10.000, **não R$ 20.000**.
- Salvar imagens dos cheques (acesso restrito, dados sensíveis protegidos) **somente se realmente necessárias**.
- Alertas configuráveis: sugestão inicial D-7, D-2 e D0; evitar duplicação de alertas no mesmo período.
- Importante: cheque pode ser apresentado antes da data pós-datada; a agenda não garante compensação somente no vencimento combinado.
- Quando houver pagamento/compensação, lançar um desembolso reconciliado à obrigação, sem criar nova despesa de material.
- Suportar pagamentos mistos (sinal Pix + cheques, boleto + Pix) e parcelamento sem cheque.

## 5.7 Recebimento documental

1. Quando loja confirmar expedição ou prazo, criar expectativa de entrega.
2. Pedreiro autorizado envia fotografia do romaneio/nota assinada ou do comprovante de entrega, preferencialmente mencionando o ID do pedido.
3. IA extrai fornecedor, número do documento, data, materiais, quantidades; cruza com pedidos abertos daquela obra/fornecedor.
4. Se houver mais de um pedido candidato, perguntar qual ID; **não supor associação**.
5. Se quantidades conferirem, marcar `DOCUMENTARILY_RECEIVED`; se parcial, `PARTIALLY_RECEIVED`, registrar diferença e avisar fornecedor.
6. Manter imagens originais e resultado da extração. Não afirmar vistoria física independente: o sistema controla **recebimento documental**; fiscaliza-se a entrega fisicamente na obra.
7. Atualizar coluna de quantidade recebida e valores relacionados ao pedido. **Não lançar novamente custo** pelo ato de receber ou pela chegada da NF.

# 6. Cotações iniciais, orçamento e desvios

A configuração da obra possui `budget_version=1` congelada: material normalizado, etapa, quantidade prevista, unidade, custo unitário original, custo total original e fornecedor/preço de referência quando aplicável. Importar a planilha existente com mapeamento assistido e revisar antes de congelar.

**Campos calculados por item:** `base_qty`, `base_unit_price`, `base_total`, `committed_qty`, `received_qty`, `committed_total`, `paid_total`, `approved_price_cap`, `latest_valid_quote`, `projected_remaining_qty = max(0, base_qty - committed_qty)` (apenas aproximação gerencial), `forecast_at_current_price`, `variance_to_base`.

**Exemplo:** 1.000 sacos orçados a R$ 30 = R$ 30.000. Comprados 400 a R$ 32 = R$ 12.800. Saldo planejado 600 × R$ 32 = R$ 19.200. Projeção do item = R$ 32.000, desvio +R$ 2.000 (+6,67%). Supõe mesma especificação, sem frete adicional, sem revisão de quantitativo.

**Não confundir:** quantidade comprada ≠ recebida ≠ consumida; receita contratada ≠ recebida; custo contratado ≠ pago. Sem medição física detalhada, evitar relatórios que se intitulem “desperdício constatado”.

**Notificações:** ao aprovar novo teto, enviar impacto unitário e estimativa de impacto no material restante; acompanhar acumulado mensal. O sistema não altera automaticamente preço de venda dos apartamentos.

# 7. Fornecedores, prazos e promoções

Cadastro mínimo: nome comercial, razão social, CNPJ/CPF quando necessário, número WhatsApp, categorias, materiais atendidos, unidade de venda, marca/linha, localização/região, prazo normal e faixa de prazo, pedido mínimo, frete/condições, formas de pagamento, Pix verificado, dias de atendimento, opt-in e status.

Prazos por **fornecedor + material + local de entrega**. Exemplos parametrizáveis: cimento local 2 dias; atacado de fora 7 a 10 dias. Se o pedreiro solicitar entrega amanhã e fornecedores usuais precisarem de 2 dias, alertar, buscar alternativa e pedir autorização para custo emergencial; não prometer entrega sem aceite da loja.

Promoções: fornecedores podem informar espontaneamente. Opcionalmente enviar **consulta periódica opt-in** (p.ex. semanal) de itens de grande consumo, respeitando janela e templates da Meta. A IA identifica oferta, prazo, qualidade, estoque e custo total; sugere oportunidade **sem comprar automaticamente**. Evitar mensagens repetitivas e limitar frequência por fornecedor.

# 8. Vendas parceladas e contas a receber

Cadastro por empreendimento: unidades imobiliárias e situação (`AVAILABLE`, `RESERVED`, `SOLD`, `CANCELLED`), contratos, compradores, valor total, data de assinatura, entrada, parcelas, encargos, índice e periodicidade de atualização **conforme contrato individual**; prazos, exceções e aditivos versionados. Não presumir índice/taxa (INCC, IPCA, juros) nem regras iguais para todos.

Para cada contrato criar cronograma de recebíveis: `installment_id`, número, data de vencimento, principal, correção prevista/aplicada, juros/encargos contratualmente autorizados, total previsto, status, pagamentos parciais, saldo e comprovantes. A soma da entrada e parcelas deve ser conciliável com o valor contratual **com as ressalvas de correção e encargos**.

**Status:** `SCHEDULED`, `DUE`, `PARTIALLY_PAID`, `PAID`, `OVERDUE`, `RENEGOTIATED`, `CANCELLED`. Suportar adiantamento, atraso, desconto, renegociação e distrato com validação humana e trilha de auditoria. Não transformar parcela vencida automaticamente em receita recebida.

**Importação legada:** planilhas, PDFs de contratos e listagens; fazer extração assistida, mostrar diferenças/ambiguidade, exigir conferência antes de ativar cronogramas. Dados pessoais e bancários de compradores são sensíveis operacionalmente; acesso restrito por organização.

**Exemplo:** venda de R$ 120.000: entrada R$ 24.000 e 24 parcelas de R$ 4.000 (sem correção). Após entrada paga e uma parcela recebida, recebido = R$ 28.000; a receber nominal = R$ 92.000. Em contratos com correção, total estimado precisa ser separado de saldo nominal.

# 9. Fluxo de caixa integrado

Exibir por organização/entidade jurídica, obra, conta bancária, fornecedor e comprador; dashboards consolidados **sem misturar empresas juridicamente distintas**.

**Indicadores obrigatórios:**
- Receita vendida contratada (não é saldo bancário).
- Recebíveis previstos por vencimento; recebidos efetivos; atrasados.
- Compras comprometidas totais; contas a pagar por vencimento; pagamentos confirmados.
- Saldo inicial verificado do período; entradas e saídas realizadas; saldo final efetivo quando conciliado.
- Projeção: `saldo inicial validado + recebimentos futuros estimados - desembolsos futuros previstos` (também inclui despesas planejadas fora das compras contratadas quando cadastradas).
- Cenário conservador configurável (ex.: parte de recebíveis pode atrasar), cenário contratual e cenário de risco. Percentuais são parâmetros, não garantias de inadimplência.
- Datas de cheques e avisos próximos, déficit projetado e itens críticos para aquisição.

**Não duplicar:** venda gera contas a receber, não dinheiro no banco; compra gera obrigação, não saída já paga; comprovante Pix informado não é quitação confirmada; baixa de recebível e transação do extrato são duas representações do **mesmo** movimento, vinculadas por ID, não somadas duas vezes.

**Exemplo ilustrativo:** saldo inicial R$ 40.000; parcelas previstas R$ 80.000; saídas contratadas R$ 60.000; despesas adicionais projetadas R$ 10.000 ⇒ saldo projetado R$ 50.000 **se as parcelas entrarem no prazo**. Em caso de inadimplência, projeção deve cair.

**Consultas pelo WhatsApp:** “quanto falta pagar nesta semana?”, “quem atrasou?”, “qual caixa em 30/60/90 dias?”, “quanto aumentou o cimento desde o orçamento?”, “quais notas faltam para o contador?”, “quais entregas estão em atraso?”. Expor dados confidenciais só ao dono autorizado.

# 10. Conciliação bancária em três fases

**Fase 1 (MVP):** dono confere manualmente o pagamento/recebimento em banco e marca confirmado, com data, valor e responsável. Upload de comprovante é anexo de apoio, não baixa automática.

**Fase 2:** importar OFX/CSV de bancos, com arquivo identificado, layout configurável, parser seguro e tela de pré-visualização. Sugestões de correspondência por valor, data, favorecido, CPF/CNPJ e identificador, com confirmação humana para conflitos. Deduplicar transações por banco+conta+ID do movimento ou hash estável; guardar hash do arquivo.

**Fase 3:** conexão bancária de leitura autorizada, mediante consentimento e avaliação de segurança e condições comerciais, **sem disparar transferências**. Manter possibilidade de conciliação manual.

**Regras:** não realizar matching somente por valor; não marcar `PAID` por reconhecimento de texto de imagem; divergência de centavos, beneficiário ou duplicidade = revisão humana; manter log de conciliação e estorno.

# 11. Fechamento contábil mensal

A central cria fechamento para cada empresa/competência, separando obras e contas bancárias. Inclui receitas e parcelas recebidas de compradores, vendas/contratos relevantes, compras por fornecedor, contas a pagar, cheques, pagamentos, conciliações, extratos e documentos fiscais.

1. No momento da compra, pedir XML da NF-e e DANFE/PDF; registrar chave de 44 dígitos quando disponível e validade fiscal a confirmar por meio apropriado.
2. Anexar fotos de recebimento e demais documentos ligados ao mesmo pedido. XML é documento eletrônico fiscal; DANFE/PDF é representação auxiliar.
3. No início do mês seguinte, localizar **somente documentos faltantes** da competência anterior; enviar aos fornecedores solicitação pontual com números de pedidos, observando autorização/templating do WhatsApp.
4. Gerar relatório de pendências (NF/XML, comprovantes, pagamentos não conciliados, lançamentos sem classificação, contas sem documento).
5. Organizar pacote `/organizacao/entidade/AAAA-MM/{notas_xml,danfe_pdf,comprovantes,extratos,recebimentos,relatorios}` e um índice CSV/XLSX, com correspondência ID compra → NF → pagamento → recebimento.
6. Mostrar tela `FECHAMENTO_PRONTO_PARA_REVISAO`; **somente o dono** aprova envio ao contador. Enviar via canal autorizado (e-mail/pasta compartilhada ou outro meio validado), com registros do que foi encaminhado.
7. Permitir reabertura controlada com histórico de versão, nunca alteração silenciosa de competências já encerradas.

**Regra fiscal:** não pedir que a loja adie a emissão da NF-e até o fim do mês; a nota deve ser emitida conforme a legislação da operação. No fechamento, solicitar cópias/documentos não recebidos. Tratamento tributário de incorporação, SPE, RET, competência e reconhecimento da receita é responsabilidade do contador; não tratar fluxo de caixa como DRE fiscal.

# 12. Mensagens exemplares (templates funcionais)

**P1 — Pedreiro, pedido com prazo:**  
“Pedido 018 recebido: 100 sacos de cimento CP II 50 kg para a obra Alfa. O prazo normal dos fornecedores é de 2 dias. Entrega estimada a confirmar: 19/11. Vou consultar as lojas.”

**P2 — Pedido urgente:**  
“Pedido 019 urgente: entrega amanhã. Menor opção regular: R$ 3.000 em 2 dias. Opção amanhã: R$ 3.180 (+R$ 180). Autoriza a alternativa urgente? [Aprovar / Recusar].”

**P3 — Cotação ao fornecedor:**  
“Cotação C-018: favor informar preço unitário e total, frete, marca, disponibilidade e entrega para 100 sacos de cimento CP II 50 kg na obra Alfa, até hoje às 15h.”

**P4 — Aprovação ao dono:**  
“Compra P-018: Loja B, 100 sacos, R$ 3.200 com entrega em 2 dias. Base R$ 30/saco; preço atual R$ 32/saco; teto aprovado R$ 32/saco. Reajuste de preço: já autorizado. **Aprova esta compra de R$ 3.200?**”

**P5 — Novo teto:**  
“Material: cimento 50 kg. Base: R$ 30. Teto autorizado: R$ 32. Nova oferta: R$ 33 (+3,13% contra teto; +10% contra base). Comprar o lote exigirá aprovar o novo teto e esta compra. Aprova?”

**P6 — Confirmação à loja:**  
“Pedido P-018 aprovado, total R$ 3.200, entrega DD/MM. Confirme manutenção do preço, disponibilidade e prazo. Se houver qualquer mudança, informe antes de faturar/despachar.”

**P7 — Pix ao dono, 1ª mensagem:**  
“Pagamento necessário. Pedido P-018 · Loja B · R$ 3.200,00 · Beneficiário: Loja B Ltda. Confira o favorecido no aplicativo do banco. Envie comprovante à loja e à central após pagar.”

**P8 — Pix ao dono, mensagem separada:**  
“CHAVE_PIX_VALIDADA_AQUI”  
*(Na produção, enviar apenas o conteúdo literal da chave validada, sem aspas ou prefixos, para facilitar cópia.)*

**P9 — Entrega:**  
“O material do pedido P-018 foi entregue? Envie a fotografia do comprovante assinado. Se houve diferença, diga a quantidade.”

**P10 — Cheque:**  
“Lembrete: cheque nº 003 do fornecedor Ferragens X, valor R$ 1.000, data combinada 10/12. Confira o saldo disponível.”

**P11 — Faltam notas:**  
“Bom dia. Estamos conferindo documentos de outubro. Não localizamos o XML e o DANFE/PDF da compra P-018, entregue em DD/MM. Poderia encaminhar esses arquivos?”

**P12 — Contador:**  
“Fechamento de outubro pronto: 54 compras, 46 notas vinculadas, 8 pendências, 21 recebimentos de apartamentos, 5 conciliações pendentes. Deseja revisar antes de enviar ao contador?”

*Nota:* exemplos são especificações de mensagem; o envio real está condicionado à API, consentimento do contato, templates aprovados, janela de conversa e regras financeiras de produção.

# 13. Arquitetura técnica sugerida

## 13.1 Princípios

- Monorepo TypeScript com `strict` e validações de dados via Zod; evitar múltiplas linguagens desnecessárias.
- Backend próprio: **Cloudflare Workers + Hono** (ou Node.js equivalente se limitações operacionais exigirem); frontend administrativo mínimo em React/Vite.
- Banco de dados transacional **PostgreSQL/Supabase**, `Row Level Security` quando acessado por cliente, armazenamento privado de anexos; migrações versionadas.
- Serviço de IA via adaptador configurável (OpenAI ou Anthropic) para fala→texto, extração estruturada e apoio à interpretação; não deixar IA efetuar mutações financeiras sem regras.
- Canal WhatsApp Meta Cloud API via adaptador; simulador de mensagens para desenvolvimento e testes. Não depender de automações não oficiais do WhatsApp Web.
- Jobs de espera/reenvio/alerta em fila persistente; **não confiar em execução única da função HTTP** ou timers locais. Cron seguro para processar jobs e lembretes.
- Google Sheets como **exportação/painel secundário**, nunca fonte de verdade financeira.
- Datas em UTC no banco e apresentação em `America/Sao_Paulo`; dinheiro `numeric(18,2)` e quantidades decimais, nunca ponto flutuante JS para cálculos monetários.
- Endpoints idempotentes, chave única de mensagens, RFQs, pedidos, parcelas e transações.

## 13.2 Serviços e custos

**Preferência:** tiers gratuitos para desenvolvimento/testes onde existirem, com validação de limites e preço na data da implantação. WhatsApp oficial, processamento da IA e possíveis provedores podem gerar cobrança; Codex/Claude Code como ferramenta de programação **não é** o backend permanente em execução. O sistema precisa de credenciais comerciais próprias quando sair do modo simulado.

## 13.3 Esquema de projeto sugerido

```
construtora-ia/
  apps/
    api/                   # Hono + webhooks + APIs + jobs
    admin/                 # painel administrativo mínimo
  packages/
    domain/                # regras puras e cálculo
    integrations/          # WhatsApp, IA, storage, e-mail, Sheets, extratos
    database/              # SQL, migrações, RLS, seeds
    shared/                # tipos, validações, DTOs
  docs/
    SPEC.md                # cópia da especificação aprovada
    ADR/                   # decisões de arquitetura
    RUNBOOK.md             # operação e incidentes
    DATA_DICTIONARY.md
    TEST_PLAN.md
  tests/
    unit/
    integration/
    e2e/
  AGENTS.md
  CLAUDE.md
  .env.example
  README.md
```

# 14. Modelo de dados mínimo (tabelas)

**Tenancy/segurança:** `tenants`, `legal_entities`, `worksites`, `users`, `memberships`, `contacts`, `whatsapp_accounts`, `supplier_optins`, `roles_permissions`, `audit_events`, `attachments`, `idempotency_keys`, `scheduled_jobs`.

**Orçamento/produtos:** `materials`, `material_aliases`, `material_equivalences`, `material_categories`, `units`, `budget_versions`, `budget_items`, `supplier_materials`, `supplier_lead_times`, `price_authorizations`, `promotions`.

**Compras:** `material_requests`, `material_request_lines`, `quote_rounds`, `quote_invitations`, `supplier_quotes`, `supplier_quote_lines`, `purchase_approvals`, `purchase_orders`, `purchase_order_lines`, `supplier_confirmations`, `deliveries`, `delivery_lines`, `invoices`, `invoice_lines`, `purchase_documents`.

**Financeiro:** `payment_obligations`, `payment_schedules`, `payment_proofs`, `cash_transactions`, `bank_accounts`, `bank_statement_imports`, `bank_statement_lines`, `bank_matches`, `payment_allocations`, `financial_categories`, `cash_projection_snapshots`.

**Vendas:** `property_units`, `buyers`, `sales_contracts`, `contract_versions`, `contract_payment_terms`, `receivable_installments`, `receipts`, `receipt_allocations`, `contract_adjustments`, `cancellations`.

**Contabilidade/comunicação:** `accounting_periods`, `accounting_packages`, `accountant_contacts`, `missing_document_requests`, `message_threads`, `inbound_messages`, `outbound_messages`, `message_templates`, `ai_extractions`.

**Campos transversais:** IDs UUID, `tenant_id`, `legal_entity_id` quando aplicável, `worksite_id` quando aplicável, datas de criação/alteração, ator, estado, versão para concorrência otimista, referência ao documento/origem. Não duplicar dados pessoais desnecessariamente.

**Restrições de integridade fundamentais:**

- `UNIQUE(whatsapp_account_id, provider_message_id)` para mensagens.
- `UNIQUE(tenant_id, legal_entity_id, invoice_access_key)` quando a chave fiscal existir e for válida.
- `UNIQUE(tenant_id, bank_account_id, external_transaction_id)` para extratos com ID confiável; fallback hash analisado.
- `UNIQUE(tenant_id, sales_contract_id, installment_number, version)` para recebíveis.
- `UNIQUE(tenant_id, purchase_order_id, installment_number)` para pagamentos parcelados.
- Aprovações ligadas a versão e hash do pedido; alterações de preço invalidam o aceite anterior.
- Triggers/constraints ou transações na camada do banco para impedir compromisso e quitação em duplicidade.

**Modelo de estados resumido:**

`MATERIAL_REQUEST`: `DRAFT → READY_TO_QUOTE → QUOTING → QUOTED → SUBMITTED_FOR_APPROVAL → APPROVED/REJECTED → ORDERED → PARTIAL_RECEIPT/RECEIVED → CLOSED`.

`PURCHASE_ORDER`: `DRAFT → PENDING_OWNER_APPROVAL → APPROVED → WAITING_SUPPLIER_CONFIRMATION → WAITING_PAYMENT (se à vista) → CONFIRMED → PARTIALLY_RECEIVED/RECEIVED → CLOSED`, com `CANCELLED`, `DISPUTED` e `EXPIRED` aplicáveis conforme transição validada.

`PAYMENT_OBLIGATION`: `SCHEDULED → DUE → REPORTED → CONFIRMED/RECONCILED`, mais `OVERDUE`, `PARTIALLY_PAID`, `CANCELLED`. `REPORTED` **não é** `CONFIRMED`.

`RECEIVABLE`: `SCHEDULED → DUE → PARTIALLY_PAID/PAID`, mais `OVERDUE`, `RENEGOTIATED`, `CANCELLED`.

# 15. Motor de regras: pseudocódigo de referência

```typescript
function analyzeQuote(quote, material, worksite, context) {
  const comparable = verifyExactOrApprovedEquivalentSpecification(quote, material)
    && verifyUnitsAndCurrency(quote)
    && verifyFreightAndDelivery(quote)
    && verifyPaymentTerms(quote);
  if (!comparable) return { decision: 'NEEDS_CLARIFICATION' };

  const normalizedUnitPrice = computeComparableUnitCost(quote);
  const baseline = budgetItem(worksite, material).originalUnitPrice;
  const cap = currentApprovedPriceCap(worksite, material, quote.paymentTerms);
  const needsPriceApproval = normalizedUnitPrice > cap;
  const increaseVsBaseline = normalizedUnitPrice - baseline;
  return {
    normalizedUnitPrice,
    increaseVsBaseline,
    needsPriceApproval,
    // Regra do MVP: a compra sempre precisa do dono.
    needsPurchaseApproval: true,
    canSendBindingPurchaseOrder: false
  };
}

function canCommitPurchase(order, approvals, supplierResponse) {
  return approvals.ownerPurchaseApproval.isValidFor(order.version)
    && (!order.needsPriceApproval || approvals.ownerPriceCapApproval.isValidFor(order.version))
    && supplierResponse.confirmsSamePriceQuantitySpecificationFreightDeadline;
}
```

Em produção, não confiar no pseudocódigo como implementação; testar limites, moedas, descontos, parcelamento, frete e concorrência. Quando receber resposta alterada do fornecedor, invalidar aprovação ligada à versão antiga e pedir nova decisão.

# 16. Segurança, LGPD e controles antifraude

1. Validar assinatura HMAC dos webhooks da Meta e o desafio de verificação de endpoint; negar origem não autenticada; respeitar limites de tentativa.
2. Validar `tenant_id`, papel e número autorizado **em toda** mutação; nunca usar telefone como único fator de autorização para operações de alto risco sem proteção adicional. Oferecer PIN/segundo fator de confirmação para ações sensíveis, equilibrando usabilidade.
3. Aprovações com ID, valor, fornecedor, versão do pedido, prazo de expiração e token único; repetir “aprovar” não pode gastar duas vezes.
4. Separar extração por IA de operações: dados de mensagens e anexos são **não confiáveis** e não podem executar instruções sobre o sistema. IA retorna estrutura e incerteza; regras e permissões autorizam ações.
5. Credenciais só em variáveis de ambiente/secret manager; nunca em arquivos versionados, logs ou mensagens de IA. Pix e dados bancários devem ter acesso mínimo.
6. RLS e testes de isolamento entre `tenants`; impedir acesso cruzado por URL, anexos, relatórios e WhatsApp.
7. Criptografia em trânsito e armazenamento, URLs privadas assinadas para arquivos fiscais e contratos, política de retenção e descarte conforme obrigações legais.
8. Log de auditoria append-only para alterações financeiras e aprovações; backup, restore testado, monitoramento, alertas e rotinas de incidentes.
9. Consentimento/base legal e transparência conforme LGPD, especialmente cadastro de compradores, telefones, contratos, documentos e extratos; controle de acesso e atendimento a direitos aplicáveis.
10. Ambiente de testes sem pagamentos ou cotações reais; `DRY_RUN` ativado por padrão e bloqueio de envio real até configuração/validação.

# 17. Requisitos não funcionais e qualidade

- Interface de WhatsApp em português, linguagem direta e dados essenciais. Uma pergunta de cada vez quando faltar informação.
- Tolerância a áudios incompletos, erros ortográficos, abreviações de materiais, fotos de baixa qualidade, duplicidade de mensagens, reenvios e falha temporária de fornecedor.
- Processamento assíncrono, tentativas com backoff, estado de processamento e fila de falhas (`dead letter`) para auditoria.
- Sem inferir preço, confirmação, saldo bancário, comprovante ou autorização quando ausentes.
- Registro de unidade comercial e normalização: barra 6 m ≠ unidade 1 m; cimento saco 50 kg ≠ saco 25 kg; desconto x frete; pagamento à vista x prazo.
- Observabilidade: número de pedidos, taxa de erro, tempo de cotação, resposta dos fornecedores, economia comparável, itens acima do orçamento e pendências.
- Exports CSV/XLSX/PDF estruturados e minimização de dados; documentação e testes automatizados suficientes para manutenção.
- Não prometer disponibilidade contínua em planos gratuitos sem monitorar suspensão, limites e suporte; preparar caminho para upgrade pago quando houver usuários reais.

# 18. Plano de desenvolvimento guiado para Codex e Claude Code

**Não tentar construir tudo de uma vez.** Criar um repositório de código e entregar funcionalidade testada a cada etapa. O objetivo de cada etapa é executabilidade com dados simulados e demonstração dos critérios de aceite.

### Etapa 0 — Projeto e simulador (primeiro pedido ao agente)

1. Criar monorepo TypeScript, scripts de execução, lint, testes, README e `.env.example`.
2. Criar `AGENTS.md` e `CLAUDE.md` apontando para `docs/SPEC.md` e regras de segurança.
3. Criar esquema de banco e migrações para tenants, obras, fornecedores, materiais, orçamento e mensagens.
4. Implementar adaptador `MockWhatsApp`, `MockAI`, armazenamento simulado e conversas/rotinas sem enviar mensagens externas.
5. Criar painel mínimo de cadastro com login simulado/dev, importação de planilha com validação, e registrar orçamento-base.
6. Implementar testes de isolamento por tenant, duplicidade de webhook e material/unidade.

**Aceite:** simular pedido por áudio transcrito/texto, cadastrar 2 fornecedores, gerar solicitações de cotação falsas, consultar estado no painel; nenhum serviço real acionado.

### Etapa 1 — Compras e aprovações

1. Implementar RFQ, análise de ofertas, unidade e custo comparável, prazos, exceções urgentes.
2. Implementar `price_authorizations` com orçamento-base preservado e teto evolutivo.
3. Implementar **aprovação exclusiva do proprietário de toda compra** e invalidação por mudança do pedido.
4. Gerar pedido somente após aprovação; pedir confirmação do fornecedor; resolver indisponibilidade e mudança de valor.
5. Implementar simulador de respostas e testes de concorrência.

**Aceite:** caso cimento 30→32 aprovado→32 sem nova aprovação de **preço**, mas exige autorização da **compra**; 33 exige autorização de aumento e compra; fornecedor mudar prazo após aprovação reabre decisão.

### Etapa 2 — Recebimento, Pix, cheques e financeiro básico

1. Implementar documentos/recebimento por foto e divergências; compras comprometidas sem duplicidade de custo.
2. Pix: cadastro/validação de beneficiário, mensagem separada da chave, upload de comprovante, estado pendente e confirmação manual.
3. Cheques e pagamentos parcelados com agenda e alertas.
4. Painel de compras, pagamentos e orçamento por material/obra.

**Aceite:** 10 cheques de R$ 1.000 de uma compra de R$ 10.000 geram custo R$ 10.000 e agenda de R$ 10.000; upload repetido não baixa duas vezes.

### Etapa 3 — Apartamentos, contratos, recebíveis e caixa

1. Criar unidades, compradores, contratos versionados e parcelas customizáveis.
2. Cadastro de entrada, vencimento, pagamentos parciais e atraso, correção por contrato (sem inferir índices).
3. Confirmar recebimento manual, separar previsto e realizado.
4. Painel e consultas via simulador: caixa 30/60/90 dias, inadimplência, saldo por obra e entidade.
5. Importador de dados legados com prévia/revisão humana.

**Aceite:** ao mudar vencimento de contrato, projeção se atualiza sem gerar novo dinheiro; comprador com parcela vencida não aparece como pago.

### Etapa 4 — WhatsApp oficial, documentos fiscais e contabilidade

1. Integrar Cloud API de forma configurável, webhooks verificados, templates e janela de conversa; pedir credenciais **apenas ao dono do ambiente**, nunca inserir segredos no repositório.
2. Integrar análise de áudio/fotos e fallback humano; fazer testes com números internos/autorizados.
3. Importação opcional OFX/CSV; conciliação assistida.
4. Fechamento contábil, cobrança de documentos **faltantes**, pacote fiscal e aprovação para envio ao contador.
5. Retentativas, monitoramento, logs e procedimentos de recuperação.

**Aceite:** executar fluxo real controlado com fornecedores de teste e autorização, sem disparos de produção inesperados; pacote mensal rastreável e sem notas duplicadas.

### Etapa 5 — Preparação de SaaS comercial

1. Autoatendimento de organizações e obras, isolamento completo, permissões e billing quando definido.
2. Onboarding fácil para fornecedores e pedreiros, configurações por cliente, políticas de retenção, backups e suporte.
3. Monitoramento de custo por cliente (mensagens, IA, mídia), limites e planos comerciais.
4. Testes de carga, privacidade, controles multi-tenant, logs e reprocessamento seguro.

**Aceite:** empresa B não enxerga documentos, mensagens, fornecedores, contratos ou relatórios de A, inclusive por IDs arbitrários.

# 19. Plano mínimo de testes / critérios de aceite

| ID | Cenário | Resultado obrigatório |
|---|---|---|
| T01 | Mesmo webhook entregue 2–5 vezes | Uma só solicitação/evento financeiro. |
| T02 | Pedreiro envia “10 tubos 25” sem comprimento/material claro | Solicitar esclarecimento; não comprar. |
| T03 | Cimento base R$ 30, teto R$ 30; oferta R$ 32 | Pedir novo teto e aprovação da compra. |
| T04 | Teto R$ 32 autorizado; próxima oferta R$ 32 | Não pedir novo teto; **pedir aprovação da compra**. |
| T05 | Teto R$ 32; oferta R$ 33 | Pedir novo teto e aprovação da compra. |
| T06 | Fornecedor altera preço após aprovação | Bloquear e reabrir aprovação. |
| T07 | Oferta barata entrega em 10 dias; obra precisa em 2 | Não selecionar automaticamente; apresentar alternativas. |
| T08 | Urgência + R$ 150 | Avisar proprietário com comparativo; nenhuma compra sem aceite. |
| T09 | Fornecedor muda chave Pix | Bloquear até verificação independente. |
| T10 | Comprovante Pix enviado sem extrato/conferência | `PAYMENT_REPORTED`, não `PAID`. |
| T11 | Compra R$ 10 mil, 10 cheques | Custo R$ 10 mil, 10 vencimentos, sem duplicação. |
| T12 | Entrega parcial 80/100 | Status parcial e pendência de 20. |
| T13 | Notas PDF/XML repetidas | Uma NF e vínculo auditável, sem duplicar compra. |
| T14 | Apartamento com 1ª parcela atrasada | Aparece a receber/vencido, não receita de caixa. |
| T15 | Venda com contrato específico de correção | Usar regra cadastrada/validada; não aplicar índice genérico. |
| T16 | Extrato com transação igual em 2 importações | Um evento bancário, alerta de duplicidade. |
| T17 | Fechamento fiscal com 3 XML ausentes | Só cobrar os 3 fornecedores/documentos pendentes. |
| T18 | Usuário da empresa A tenta acessar B | Acesso negado, inclusive arquivos. |
| T19 | Dono envia “APROVAR” sem referência inequívoca | Pedir identificação do pedido; não autorizar. |
| T20 | Plano de hospedagem/free entra em indisponibilidade | Sistema preserva jobs, permite reprocessar e alerta operador. |

# 20. Dados de implantação e decisões configuráveis

Não colocar valores fictícios como produção. Obter da empresa, quando for configurar:

1. Nome da organização e entidades jurídicas; obras e responsáveis; número WhatsApp central e WhatsApp autorizado do dono.
2. Arquivos legados (planilha de materiais/orçamento, listas de fornecedores e contratos de vendas). Fazer cópia de segurança e importação de teste, **não sobrescrever arquivos de origem**.
3. Cadastro de materiais e padronização de unidades/equivalências; cronograma de compras e prazos por fornecedor.
4. Condições de pagamento por loja; dados fiscais/beneficiários validados; se fornecedor permite cotação por WhatsApp.
5. Limites de horário, retentativas, janelas de cotação, políticas de contato, dias de alerta de cheques e parcelas.
6. Conta bancária/centro de custos por entidade, saldo inicial confirmado, formatos de extrato e regras de conciliação.
7. Contratos de apartamentos com índices/juros/regras **por contrato** e critérios de vencimento.
8. Contador e forma autorizada de entrega do fechamento, com arquivos e checklist acordados com o escritório contábil.
9. Credenciais Meta API, banco, IA e hospedagem, quando sair do simulador.

**Decisões ainda não especificadas, mas sem impedir a Etapa 0:** política exata do PIN/segundo fator, hora-limite de cotações, se teto por fornecedor ou global, frequência de monitoramento de promoções, quais índices contratuais os clientes possuem, destinatário do pacote contábil, níveis de plano SaaS e cronograma comercial. Todos devem ser configuráveis; manter padrão conservador e testes.

# 21. Entregáveis esperados da IA programadora

- Repositório com código executável, banco e migrações versionadas.
- `README.md`: rodar localmente em passos simples, ambientes de simulação e produção, custo/credenciais externas necessários.
- `.env.example`: nomes de variáveis sem segredos, e explicação de cada uma.
- `docs/SPEC.md`, `docs/ADR/`, `AGENTS.md`, `CLAUDE.md`, `docs/TEST_PLAN.md`, `docs/RUNBOOK.md`.
- Testes automatizados de domínio e integração; comando único para rodar testes e demonstrar o fluxo.
- Massa fictícia de demonstração: 1 empresa, 1 obra, 5 fornecedores, 10 materiais, 2 apartamentos e cronogramas fictícios.
- Painel administrativo mínimo responsivo para cadastro/revisão, sem sobrecarregar os usuários do WhatsApp.
- Modo `DRY_RUN` ligado até intervenção humana e permissões de produção.
- Relatório ao final de cada etapa: o que funciona de verdade, o que está simulado, testes executados, riscos e próximo passo. Não declarar integração finalizada sem credenciais e testes reais.

# 22. Instrução inicial para colar no Codex ou Claude Code

> Leia integralmente o arquivo `ESPECIFICACAO_COMPLETA.md` anexado, especialmente as seções 2, 5, 14, 16, 18 e 19. Você está implementando o produto **Construtora IA**, um sistema multiempresa de compras, orçamento, recebimentos, financeiro, vendas parceladas de apartamentos e fechamento contábil pelo WhatsApp. **Implemente agora apenas a Etapa 0** descrita na seção 18, deixando a estrutura preparada para as próximas etapas. Priorize simplicidade, idempotência, separação de dados entre empresas e segurança. Use TypeScript, PostgreSQL/Supabase, adaptadores para WhatsApp e IA, testes e ambiente simulado; não mande mensagens reais, não efetue pagamentos e não invente credenciais. Crie `AGENTS.md` e `CLAUDE.md`, a estrutura do repositório, migrações, documentação e código executável. Rode os testes possíveis; ao terminar, informe arquivos criados, comandos para rodar, o que está simulado e quais critérios de aceite foram cumpridos. Não tente fazer todas as etapas de uma vez. Depois aguarde minha orientação para a Etapa 1.

---

# 23. Registro unificado de solicitações do idealizador

Esta seção reúne, sem atribuir como já implementado, os pedidos feitos desde o começo da conversa:

1. **WhatsApp único** conectado entre escritório e obra; pedreiros falam com IA em linguagem natural, inclusive áudio; fornecedores cadastrados com especialidade e número de WhatsApp; simplicidade radical para todos.
2. **Cotações múltiplas**, por exemplo cinco lojas de cimento ou duas lojas do mesmo material; IA compara preço e condições e direciona ao vencedor; não fazer compra quando loja alterar valor sem avisar; guardar conversas/propostas.
3. **Pedido condicionado** à confirmação de manutenção do preço: vendedor não deve faturar/expedir se houver aumento ou mudança relevante; IA avisa proprietário e só prossegue após autorização.
4. **Tabela de materiais da engenharia:** quantitativos e orçamento iniciais, acompanhamento do que foi comprado, pedido, recebido e gasto; comparação com os valores previstos durante toda a construção.
5. **Base histórica de preços:** registrar todas as cotações pré-obra; notificar aumentos e impactos, para acompanhar margem e, se necessário, rever preço de venda dos apartamentos.
6. **Teto de preço evolutivo:** uma alta de R$ 30 para R$ 32 aprovada não exige repetir aprovação do *reajuste* em cada compra a R$ 32; acima de R$ 32 requer novo aceite; manter R$ 30 como base.
7. **Prazos por material/fornecedor:** cimento 2 dias e atacadistas externos 7–10 dias, orientando planejamento do pedreiro.
8. **Emergências:** esquecimento do pedreiro ou pedido urgente que implique custo maior deve chegar ao dono com opções para autorizar ou não.
9. **Entrega documentada:** celular autorizado do pedreiro envia foto de nota/romaneio assinado; IA vincula solicitação, ordem e recebimento, confere quantidade documental.
10. **Pix:** fornecedor pede pagamento, fornece chave quando ausente; IA manda pedido/valor e chave separada para copiar; dono paga pelo banco, envia comprovante à loja e central; conciliar sem presumir liquidação por foto.
11. **Cheques pré-datados:** compras com várias parcelas/cheques, valores e datas; alertas prévios e contas a pagar organizadas.
12. **Vendas de apartamentos:** registrar unidades, contratos, entrada, parcelas, vencimentos e recebimentos, variando regras de correção conforme cada contrato.
13. **Fluxo financeiro:** cruzar entradas de compradores com pagamentos de materiais, cheques e outras despesas, prever saldo e disponibilidade de caixa.
14. **Extratos:** começar com conferência manual; depois importação de OFX/CSV; futuramente integração bancária automática de leitura.
15. **Contabilidade mensal:** organizar compras, notas, XML/PDF, pagamentos, vendas, recebimentos, extratos, cobrar documentos faltantes e enviar pacote ao contador; estudar integração contábil online futuramente.
16. **Promoções:** consultar periodicamente fornecedores e analisar ofertas espontâneas de itens utilizados, sem obrigatoriedade de compra.
17. **Sem estoque físico** na etapa inicial; proprietário fiscaliza fisicamente a obra e compara quantidades entregues com evolução observada.
18. **Ferramentas:** criar preferencialmente com Codex/Claude Code e serviços gratuitos/baixo custo, evitando n8n se desnecessário; Supabase e outros serviços permitidos se agregarem robustez.
19. **Produto comercial:** após testar na própria construtora, vender a empresas e proprietários de obras; preparar isolamento de clientes, empresas e obras desde a estrutura inicial.
20. **Governança:** somente o proprietário aprova compras; preservar o histórico, não inventar valores, não duplicar custos ou pagamentos, fornecer indicadores e comunicação extremamente simples.
21. **Documento de execução:** especificação completa, passo a passo, regras de negócio, exemplos, testes e um texto inicial utilizável tanto no Codex quanto no Claude Code, com possibilidade de futuras revisões.

# 24. Referências oficiais para validar na implantação

Estas fontes sustentam decisões de plataforma, mas **preços, limites e políticas podem mudar**. O agente responsável pela implantação deve revalidar as versões vigentes.

- Meta WhatsApp Business Platform: https://developers.facebook.com/documentation/business-messaging/whatsapp/overview
- Meta Graph API Webhooks: https://developers.facebook.com/docs/graph-api/webhooks/getting-started/
- OpenAI Codex e orientações de projeto: https://developers.openai.com/cookbook/examples/codex/iterating-development-workflows-with-codex
- Anthropic Claude Code: https://docs.anthropic.com/en/docs/claude-code/getting-started
- Supabase pricing e limites: https://supabase.com/pricing
- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- NF-e e DANFE, portal nacional: https://www.nfe.fazenda.gov.br/portal/perguntasFrequentes.aspx

---

**Situação:** especificação consolidada e pronta para servir de base a agentes de desenvolvimento. Não é declaração de que o software foi construído ou implantado. **Alterações futuras:** registrar em `CHANGELOG.md`, revisar regras afetadas e testes, preservar versões do orçamento e trilhas financeiras.
