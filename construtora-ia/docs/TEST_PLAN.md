# Plano e evidências de testes — Etapas 0 a 5

Esta entrega cobre o projeto e o simulador (Etapa 0) e compras e aprovações (Etapa 1) definidos na seção 18 de [SPEC.md](SPEC.md). Cenários de recebimento, Pix, cheques, financeiro e contabilidade da seção 19 continuam reservados às etapas correspondentes.

## Comandos

```sh
npm test
npm run typecheck
npm run lint
npm run build
npm run demo
```

`npm test` executa os arquivos em `tests/` com Vitest. Cada teste de integração deve usar banco isolado para não alterar a demonstração persistente. O script `demo` exercita o fluxo completo local.

## Critérios de aceite desta etapa

| Cenário | Resultado esperado |
|---|---|
| Texto com material, unidade, quantidade e data claros | Solicitação pronta para cotar, sem compra |
| Transcrição de áudio digitada | Mesmo fluxo do texto, preservando a origem simulada |
| Mensagem ambígua, como “10 tubos 25” | Esclarecimento; nenhum convite antes da validação |
| Repetir identificador de mensagem 2–5 vezes | Uma única solicitação e resultado idempotente |
| Reusar identificador com conteúdo alterado | Rejeição do conflito |
| Gerar convites novamente | Sem duplicar convites/mensagens |
| Dois fornecedores cadastrados, elegíveis e com consentimento | Convites individuais apenas simulados |
| Fornecedor sem consentimento/inativo | Não recebe convite simulado automático |
| Organização A usa ID de B | Nenhum acesso ou mutação cruzada |
| Solicitante tenta consultar obra não autorizada | Acesso negado ou recurso omitido |
| Escritório tenta alterar cadastro/orçamento | Acesso negado |
| Material comercial diferente ou unidade incompatível | Não converter silenciosamente |
| CSV válido, prévia e confirmação | Rascunho persistido com valores conferidos |
| CSV inválido ou sem confirmação | Sem importação parcial silenciosa |
| Congelamento e retificação | Versão congelada intacta; nova versão separada |
| Alteração/exclusão de auditoria ou orçamento congelado | Bloqueio no nível implementado de banco/API |
| Reiniciar servidor no mesmo DATA_DIR | Registros preservados |
| DRY_RUN=false ou NODE_ENV=production | Inicialização recusada |

## Critérios de aceite da Etapa 1 (`tests/purchasing*.test.ts`)

| Cenário (ID da seção 19) | Resultado verificado |
|---|---|
| T03 cimento base 30, oferta 32 | Exige novo teto **e** compra; teto vira 32 só após aprovação explícita |
| T04 teto 32, nova oferta 32 | Sem novo teto; a compra ainda exige aprovação; nada é enviado antes |
| T05 teto 32, oferta 33 | Exige novo teto e compra; teto anterior fica `SUPERSEDED` |
| T06 fornecedor altera preço/prazo após aprovação | Aprovação `INVALIDATED`, versão+1, bloqueio até nova decisão; aprovação antiga não vale |
| T07 barata em 10 dias, obra precisa em 2–3 | Não é selecionada; alternativas com custo incremental |
| T08 urgência | Justificativa obrigatória; cartão ao proprietário com habitual × emergencial, R$ e %; nenhuma compra sem aceite |
| T19 “aprovar” sem referência | 400/409; nada autorizado |
| Mensagem de fornecedor duplicada (5×) | Uma proposta; ID reutilizado com outro conteúdo → 409 |
| Fornecedor sem resposta | Encerra com propostas disponíveis, `NO_RESPONSE`, comparação limitada exige reconhecimento; zero comparável não encerra |
| Proposta sem frete/prazo/pagamento | Incomparável; esclarecimento cria versão 2 e preserva a original |
| Fornecedor aumenta preço após cotar | Nova versão substitui; proprietário avisado; original preservada |
| Pedido duplicado / 5 aprovações concorrentes | Um pedido ativo; uma aprovação; uma mensagem ao fornecedor |
| Indisponibilidade / sem confirmação / cancelamento | Solicitação volta à comparação; sem pedido paralelo enquanto ativo |
| Aprovação expirada | `EXPIRED`, sem aprovação gravada |
| Teto por condição de pagamento | 32 à vista não vale para Pix antecipado |
| Material sem preço-base | Exige decisão; não inventa teto |
| Sigilo comercial | Mensagens a fornecedores sem preços de concorrentes, orçamento ou teto |
| T18 isolamento | Outra empresa: 404 em todas as rotas e RLS sem linhas |
| Perfis | Encarregado e escritório recebem 403 nas ações; encarregado não vê propostas/pedidos |
| Banco | SQL direto não consegue pular a aprovação, alterar termos aprovados, editar tetos/aprovações/propostas ou excluir histórico |
| Domínio | Decimais (0,1+0,2), frete no custo comparável, parser conservador, hash muda com qualquer termo |

## Verificação visual

Etapa 1 (revisada em Chromium headless, desktop 1360 px e móvel 390 px): Compras (aprovações, cotações, pedidos), Preços e desvios, aprovação e confirmação pelo fornecedor via interface, modal de preparação com reconhecimentos obrigatórios; sem erros de console; sem rolagem horizontal da página (corrigido o transbordamento de `.sr-only` em tabelas).

Etapa 0: 

revisar login, navegação, estados vazios, erro de API, cadastros, conversa simulada, prévia de CSV, congelamento e exportação. Verificar viewport móvel e desktop, foco de campos e controles com rótulos. Testes automatizados de API não substituem essa revisão visual.

## Evidência de execução — Etapa 0

Verificação em 18/11/2026, Node.js 24.22.1:

- `npm test`: **42 testes aprovados em 4 arquivos**, incluindo concorrência de webhook, isolamento por empresa e obra, RLS, papéis, imutabilidade, importação, limites monetários e reinício com persistência.
- `npm run build`: TypeScript estrito e Vite concluídos.
- `npm run lint`: sem erros.
- `npm run demo`: 5 fornecedores, 10 materiais, pedido em `QUOTING`, 3 convites simulados, reentrega deduplicada e zero mensagens externas.
- Chrome desktop no ambiente Cloud: entrada como proprietário, pedido por áudio já transcrito, geração de 3 convites, reentrega sem duplicação, CSV com prévia e confirmação, congelamento preservando versão anterior e cadastro de fornecedor fictício concluídos pela interface.
- Primeira execução: diretório de banco criado automaticamente; testes usam também caminho aninhado inicialmente inexistente.

A interface contém regras responsivas. Viewports móveis não foram exercitados nesta rodada; a revisão visual foi desktop. O login é simulado e não houve homologação de produção.

## Evidência de execução — Etapa 1

- `npm test`: **80 testes aprovados em 6 arquivos** (42 da Etapa 0 + 21 de API/banco + 17 de domínio).
- `npm run typecheck`, `npm run lint`, `npm run build`: sem erros.
- `npm run demo`: respostas simuladas → comparação → teto 30→32 bloqueado até autorização explícita → aprovação do proprietário → confirmação do fornecedor, zero mensagens externas.
- Limites: PGlite embarcado e simulador; nenhum WhatsApp, IA, banco ou fornecedor real foi usado; sem teste de carga, sem teste de falha de infraestrutura (T20).

## Cobertura em relação à especificação

- T01: duplicidade do evento simulado; não é teste de webhook Meta assinado.
- T02: esclarecimento de material/unidade ambíguos.
- T18: isolamento das entidades da Etapa 0; documentos fiscais e contratos ainda não existem na aplicação.
- T03–T08 e T19: implementados e testados na Etapa 1 (ver tabela acima).
- T09–T17: Pix, cheques, recebimento, notas, contratos e conciliação são etapas posteriores, sem alegação de implementação ou homologação.
- T20: persistência local verificada quando executado o ensaio de reinício; indisponibilidade de provedor, filas externas e alertas operacionais não homologados.

Não foram integrados números de WhatsApp, APIs de IA, bancos comerciais ou Supabase remoto. Nenhum resultado local deve ser descrito como validação desses serviços.


## Etapas 2 a 5 — cobertura e evidências (resumo)

| Arquivo | Foco |
|---|---|
| `receiving-payments.test.ts` | T09–T12: recebimento parcial/excesso/ilegível, 10 cheques sem duplicar custo, Pix (chave nova bloqueada, duas mensagens, comprovante ≠ pago, valor divergente), rotinas D-7/D-2/D0, cotação no prazo, configurações |
| `sales.test.ts` | T14/T15: parcela vencida ≠ caixa, regra de correção por contrato, recebimento parcial/idempotente/estorno, renegociação, caixa 30/60/90, importador |
| `stage4-domain.test.ts`, `whatsapp.test.ts` | Assinatura HMAC, T01/T19 por WhatsApp, janela de 24 h, fila/retentativas/falhas, mídia/áudio, consultas, IA validada |
| `accounting.test.ts` | T13/T16/T17: NF-e sem duplicar, extrato repetido, conciliação conservadora, fechamento só do que falta, pacote ZIP, e-mail |
| `auth.test.ts`, `config.test.ts` | Login/bloqueio/sessões, usuários e papéis, isolamento, planos, cabeçalhos, LGPD, configuração insegura recusada |
| `backup.test.ts` | Backup a quente e restauração sem sobrescrever |

**Evidência (18/11/2026):** `npm test` = **179 testes em 14 arquivos, aprovados em PGlite e em PostgreSQL 16.15** (mesma bateria, `TEST_PG_ADMIN_URL`); `typecheck`, `lint`, `build` sem erros; `npm audit` sem vulnerabilidades; inicialização em modo produção a partir de instalação só com dependências de execução; navegação real no Chromium (login por senha, troca obrigatória, telas principais) sem erros de console.

**Não verificado:** Meta WhatsApp, Anthropic, STT e SMTP reais; build da imagem Docker; carga/desempenho; PostgreSQL gerenciado (Supabase) com papel não superusuário; aplicativos móveis reais; T20 (indisponibilidade de hospedagem) além de reprocessamento local.
