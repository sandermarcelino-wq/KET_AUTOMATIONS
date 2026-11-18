# ADR 0007 — Autenticação real, SaaS, PostgreSQL e preparação de produção (Etapa 5)

Data: 2026-11-18. Estado: adotada.

1. **Autenticação**: `users` (e-mail único na plataforma, hash scrypt N=32768) ligado a um `contact` (papel/obras/telefone), `auth_sessions` (token aleatório de 256 bits guardado só como SHA-256, expiração absoluta `SESSION_HOURS`). Bloqueio de 15 min após 5 falhas, limitadores por IP/e-mail, resposta idêntica para usuário inexistente/senha errada (com hash fictício para tempo constante). Senha provisória ⇒ `must_change_password` (a API só aceita trocar a senha até lá).
2. **Papéis**: exatamente um `owner` por empresa (aprovador). O proprietário cria usuários (encarregado com obras, escritório), desativa/reativa e redefine senhas; todas as sessões do usuário são revogadas nessas ações. Troca de proprietário: procedimento do operador (não há autosserviço).
3. **Configuração segura** (`resolveConfig`): produção ⇒ login de desenvolvimento desligado e sem dados de demonstração por padrão; `DRY_RUN=false`/`WHATSAPP_LIVE=true` exigem autenticação real e todas as credenciais; o servidor recusa iniciar de outro modo. `BOOTSTRAP_*` cria a primeira empresa.
4. **SaaS**: auto-cadastro de empresa (opcional, com limite por IP), `tenant_plans` com limites **nulos por padrão** (nada comercial é inventado; o operador define via `PLATFORM_ADMIN_TOKEN`), medição de uso (`usage_counters`: mensagens por gatilho, chamadas de IA), limites rígidos de obras/usuários/armazenamento e medição sem bloqueio para mensagens/IA. **Cobrança não implementada.**
5. **PostgreSQL**: adaptador `pg` com a mesma interface; migrações idênticas; conexão do sistema com superusuário/`BYPASSRLS`. Sob concorrência real foram adicionados `SELECT … FOR UPDATE` (solicitação, pedido, obrigação, parcela, contrato) e travas consultivas (numeração, mensagens duplicadas, importações, NF). **Toda a bateria de testes passa em PGlite e em PostgreSQL 16.**
6. **Endurecimento**: CSP/XFO/nosniff/HSTS/no-store; webhook só com HMAC; limites de corpo; dependências atualizadas (0 vulnerabilidades no `npm audit`).
7. **LGPD**: base legal obrigatória do comprador, exportação e eliminação (só sem contrato vinculado, por retenção legal).
8. **Backup**: `npm run backup/restore` e rota a quente do operador (PGlite); `pg_dump` para PostgreSQL.

## Limites
Sem 2FA/TOTP, sem recuperação de senha por e-mail, limitadores em memória, sem WAF, sem cobrança, sem teste de carga, imagem Docker não construída no ambiente de desenvolvimento, e nenhum serviço externo real (Meta/Anthropic/STT/SMTP) foi exercitado.
