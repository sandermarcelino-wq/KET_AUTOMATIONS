# Segurança e LGPD — resumo operacional

**Autenticação**: e-mail+senha (scrypt, política de senha, bloqueio após 5 falhas, limite por IP/e-mail, sessão de 12 h guardada apenas como hash, revogação ao trocar/redefinir senha ou desativar). Login de desenvolvimento só existe fora de produção e nunca com modo real.
**Autorização**: perfis `owner` (único aprovador), `site_requester` (obras autorizadas, sem preços/financeiro), `operator_readonly`. Permissões vêm da sessão, nunca do corpo; o banco repete as regras críticas por gatilhos (aprovação de compra e teto, baixas, histórico imutável).
**Isolamento**: `tenant_id` + RLS forçada em todas as tabelas; testes de acesso cruzado por ID em todas as rotas; anexos privados por empresa.
**Entrada não confiável**: mensagens, XML (sem DTD/entidades), arquivos (tipo verificado pelo conteúdo, limites), CSV (proteção contra injeção de fórmula), saída de IA validada por esquema e regras; a IA nunca executa ações.
**WhatsApp**: webhook só com HMAC válido; deduplicação por ID; aprovação por código HMAC ligado à versão; limite de tentativas.
**Transporte/navegador**: CSP restritiva, `X-Frame-Options`, `nosniff`, HSTS em produção, `no-store` nas respostas da API.
**Dados**: auditoria append-only; backups; direitos do titular (exportação e eliminação quando não há obrigação de retenção) em Vendas → Compradores.
**Limites conhecidos**: limites de taxa em memória (por processo); autenticação sem segundo fator (TOTP) e sem recuperação de senha por e-mail (o proprietário redefine senhas dos usuários; troca de proprietário é procedimento do operador); sem WAF; faturamento do SaaS não implementado; adaptadores externos validados só com respostas simuladas.
