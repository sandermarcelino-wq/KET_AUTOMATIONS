# Construtora IA

Sistema de gestão de obras: compras e cotações com aprovação exclusiva do proprietário, teto de preço evolutivo, recebimento documental, Pix e cheques, vendas de apartamentos com recebíveis, fluxo de caixa, conciliação de extratos, notas fiscais e fechamento contábil — operado por painel web e por WhatsApp. Multiempresa (SaaS), em português.

**Estado honesto:** todo o código, os testes e as regras de negócio estão implementados e verificados (197 testes, em PGlite **e** PostgreSQL 16). **Nenhum serviço externo real foi exercitado** — WhatsApp Cloud API, IA, transcrição e SMTP têm adaptadores completos testados contra respostas simuladas e começam **desligados**. O sistema nunca paga, transfere dinheiro ou compra sozinho: toda compra exige aprovação do proprietário e toda baixa financeira é confirmada por ele.

## Executar (desenvolvimento, dados fictícios)
```sh
npm ci
npm run dev        # painel http://127.0.0.1:5173 · API http://127.0.0.1:3001
```
Na tela inicial escolha a empresa de demonstração e o perfil **Proprietário**. O login de desenvolvimento só existe fora de produção. `npm run demo` percorre o fluxo de compras no terminal.

```sh
npm test           # 197 testes (PGlite em memória)
TEST_PG_ADMIN_URL=postgres://postgres@127.0.0.1:5432/postgres npm test   # mesma bateria em PostgreSQL
npm run typecheck && npm run lint && npm run build
```

## Produção
Veja **[docs/DEPLOY.md](docs/DEPLOY.md)** (variáveis, Meta/WhatsApp, IA, SMTP, backup, lista de verificação) e **[docs/SECURITY.md](docs/SECURITY.md)**. Em `NODE_ENV=production` o servidor exige autenticação real e recusa configurações inseguras.

## O que o sistema faz
| Área | Resumo |
|---|---|
| Cadastros | Empresas, obras, materiais (unidade comercial), fornecedores (CNPJ, consentimento, prazos), contatos, usuários e papéis |
| Orçamento | Importação CSV com prévia, versões, **orçamento-base congelado e preservado** |
| Compras | Pedido por texto/áudio transcrito → cotação a vários fornecedores → comparação (preço+frete+prazo+condição) → **teto de preço** ≠ **aprovação da compra** → pedido ao fornecedor com aviso de não alterar → confirmação, alteração (reabre aprovação), indisponibilidade, urgência |
| Recebimento | Fotografia/nota do pedreiro, parcial/total/divergência, sem relançar custo |
| Pagamentos | Pix (chave verificada, duas mensagens), comprovante *informado ≠ confirmado*, cheques e parcelas com avisos D-7/D-2/D0 |
| Vendas | Unidades, compradores (LGPD), contratos com regra de correção **própria** de cada contrato, parcelas, renegociação, recebimentos manuais |
| Caixa | Realizado × previsto, projeção 30/60/90 dias, lançamentos manuais, por obra |
| Conciliação | Extratos OFX/CSV; sugestão só com valor+data+contraparte; confirmação do proprietário |
| Contabilidade | NF-e XML/PDF sem duplicidade, cobrança só do que falta, pacote ZIP por empresa/obra/competência, envio ao contador após aprovação |
| WhatsApp | Webhook assinado, fila com janela de 24 h/templates e retentativas, aprovação por código, consultas numéricas ("quanto temos para receber este mês?") |
| SaaS | Auto-cadastro opcional, isolamento por empresa (RLS), planos/limites configuráveis, medição de uso, backup |

## Organização
```text
apps/api/        Hono: rotas (purchasing, finance, sales, banking, fiscal, whatsapp, auth…), rotinas, integrações
apps/admin/      Painel React/Vite
packages/domain/ Regras determinísticas (decimal): comparação, teto, parcelas, caixa, conciliação, NF-e, mensagens
packages/integrations/  Adaptadores: WhatsApp Cloud, Claude, STT, SMTP (+ simulados)
packages/database/      Migrações SQL (001–007), PGlite e PostgreSQL, backup
packages/shared/        Tipos do contrato painel↔API
tests/  docs/  scripts/
```

## Documentação
[Especificação](docs/SPEC.md) · [Decisões (ADR 0001–0007)](docs/ADR) · [Plano e evidências de testes](docs/TEST_PLAN.md) · [Contrato da API](docs/API_CONTRACT.md) · [Dicionário de dados](docs/DATA_DICTIONARY.md) · [Runbook](docs/RUNBOOK.md) · [Implantação](docs/DEPLOY.md) · [Segurança](docs/SECURITY.md) · [Histórico](CHANGELOG.md)

## Não implementado / fora do escopo
Cobrança de assinaturas, 2FA e recuperação de senha por e-mail, integração bancária automática, OCR/visão em produção (a leitura de fotos depende da IA configurada), integração com sistemas contábeis, Google Sheets direto (há exportação CSV), emissão de boletos/notas, controle físico de estoque e cálculo de índices econômicos.
