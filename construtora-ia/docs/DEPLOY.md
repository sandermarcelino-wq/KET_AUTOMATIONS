# Implantação e configuração das integrações

> Este documento diz **exatamente o que é preciso** para sair do modo simulado. Nada aqui foi executado contra serviços reais pela entrega de desenvolvimento: faça primeiro uma rodada controlada, com números/fornecedores de teste.

## 1. Arquitetura de execução
- Um processo Node.js 22 (API Hono + painel estático) e um banco: **PGlite embarcado** (uma instância, simples e barato) ou **PostgreSQL/Supabase** via `DATABASE_URL`.
- O SaaS multiempresa e qualquer cenário com mais de uma instância da aplicação devem usar **PostgreSQL** (o código foi verificado contra PostgreSQL 16 com a mesma bateria de testes). A conexão do sistema deve ser **superusuário ou ter `BYPASSRLS`** (rotinas, login, roteamento do webhook); as requisições assumem o papel restrito `construtora_app` com RLS.
- Rotinas e fila de WhatsApp rodam dentro do processo (`JOBS_INTERVAL_MINUTES`, envio a cada minuto). Mantenha **uma única instância ativa** com PGlite.

## 2. Variáveis de ambiente (nunca no repositório)
| Variável | Para quê |
|---|---|
| `NODE_ENV=production` | Autenticação real obrigatória, sem dados de demonstração, HSTS, cadastro público desligado por padrão |
| `DATABASE_URL` | PostgreSQL/Supabase (omita para usar PGlite em `DATA_DIR`) |
| `BOOTSTRAP_OWNER_EMAIL/PASSWORD/PHONE/NAME`, `BOOTSTRAP_COMPANY` | Cria a primeira empresa e o proprietário se ainda não houver usuários (senha provisória: troca obrigatória no 1º acesso) |
| `SIGNUP_ENABLED=true` | Libera auto-cadastro de empresas (SaaS); `SIGNUP_RATE_PER_HOUR` limita por IP |
| `TRUST_PROXY=true` | Use o IP de `X-Forwarded-For` (só atrás de proxy confiável) |
| `DRY_RUN=false` + `WHATSAPP_LIVE=true` | Envio real de WhatsApp (exige as 4 variáveis abaixo e autenticação real) |
| `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_ACCESS_TOKEN`, `APPROVAL_CODE_SECRET` | WhatsApp Cloud API e código de aprovação |
| `WHATSAPP_GENERIC_TEMPLATE=nome:pt_BR` | Template aprovado para mensagens fora da janela de 24 h |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | IA (opcional) |
| `STT_API_URL`, `STT_API_KEY` | Transcrição de áudio (opcional) |
| `SMTP_HOST/PORT/USER/PASS/FROM` | E-mail real ao contador (opcional; senão é simulado) |
| `PLATFORM_ADMIN_TOKEN` (≥ 24 caracteres) | Operador do SaaS: planos/limites, listagem, backup (`x-platform-admin`) |
| `BACKUP_DIR`, `JOBS_INTERVAL_MINUTES`, `SESSION_HOURS` | Operação |

O servidor **recusa iniciar** com configuração insegura (ex.: produção com login de desenvolvimento, modo real sem credenciais).

## 3. Passo a passo
1. **Servidor + HTTPS**: Docker (`Dockerfile`, `docker-compose.yml`) ou `npm ci --omit=dev && npm run build && npm start`. Coloque atrás de Caddy/Nginx com TLS (a Meta exige HTTPS válido no webhook).
2. **Primeiro acesso**: defina `BOOTSTRAP_*`, inicie, entre com a senha provisória e troque-a. Cadastre obras, materiais, fornecedores (com consentimento) e importe o orçamento; **congele** a versão-base.
3. **WhatsApp (Meta)** — requer conta e verificação da empresa na Meta, número dedicado ao WhatsApp Business Platform, app com produto WhatsApp, **usuário do sistema com token permanente**; tarifas por conversa/mensagem da Meta se aplicam:
   - Webhook: URL `https://SEU-DOMINIO/webhook/whatsapp`, token de verificação = `META_VERIFY_TOKEN`, assine o campo `messages`. `META_APP_SECRET` valida a assinatura.
   - Em **WhatsApp → Cadastrar número** informe o `phone_number_id`.
   - Crie e aprove um **template** genérico (1 variável de texto) para mensagens fora da janela de 24 h e informe em `WHATSAPP_GENERIC_TEMPLATE`.
   - Cadastre telefones (E.164) do proprietário, encarregados e fornecedores **com consentimento**. Teste só com números internos antes de ligar fornecedores reais.
   - Só então `DRY_RUN=false` e `WHATSAPP_LIVE=true`.
4. **IA** (opcional): chave da Anthropic (cobrança por uso). Sem ela, o sistema funciona por regras e pede esclarecimentos.
5. **Contador**: cadastre e-mail em Contabilidade; SMTP é opcional.
6. **Backup**: ver §5. **Monitoramento**: `GET /api/health` (usado no `HEALTHCHECK`), fila/falhas em WhatsApp, avisos em Financeiro.

## 4. Custos e dependências externas (sem promessa de gratuidade)
Hospedagem do processo e do banco; Meta WhatsApp (tarifas por mensagem/conversa); IA e transcrição por uso; SMTP/e-mail; domínio e certificado. PGlite não tem custo adicional, mas é instância única.

## 5. Backup e restauração
- **PGlite**: `npm run backup` (servidor parado) ou `POST /api/platform/backup` (a quente, com `PLATFORM_ADMIN_TOKEN`). Restaurar: `DATA_DIR=./data/novo npm run restore -- backups/arquivo.tar.gz` (recusa sobrescrever). Teste a restauração periodicamente e guarde cópias fora do servidor.
- **PostgreSQL**: `pg_dump --format=custom`, política do provedor (PITR no Supabase/RDS) e teste de `pg_restore`.

## 6. Atualização
Faça backup → publique a nova versão → as migrações SQL rodam sozinhas na inicialização (idempotentes, registradas em `schema_migrations`). Em caso de falha, restaure o backup.

## 7. Lista de verificação antes do uso real
- [ ] HTTPS e proxy; `TRUST_PROXY` correto; porta do app não exposta.
- [ ] Segredos apenas em variáveis de ambiente; `APPROVAL_CODE_SECRET` fixo e longo.
- [ ] Proprietário trocou a senha provisória; usuários criados por perfil.
- [ ] Orçamento-base congelado; preços/tetos conferidos.
- [ ] Rodada de teste com números e fornecedores internos (cotação → aprovação → confirmação → recebimento → pagamento → conciliação).
- [ ] Backup testado; alertas de falha acompanhados.
- [ ] Política de privacidade e base legal dos dados de compradores/fornecedores definidas (LGPD); prazo de retenção acordado com o contador/jurídico.
