# Instruções de projeto — Claude Code

Leia `AGENTS.md` e `docs/SPEC.md` integralmente. Siga as decisões aprovadas, sobretudo as regras de autorização do proprietário, teto de preço evolutivo, conciliação financeira manual inicial, contratos de apartamentos individuais e separação multi-tenant. Trabalhe por etapas de desenvolvimento da seção 18, com testes e ambiente simulado primeiro. A entrega atual cobre as Etapas 0 a 5 do plano (ver `CHANGELOG.md`); consulte `docs/ADR/` (0001–0007), `docs/DEPLOY.md` e `docs/SECURITY.md`. Adaptadores externos (Meta, IA, STT, SMTP) só foram verificados com respostas simuladas.

Ao concluir cada etapa, liste o que funciona, o que depende de credenciais, os testes executados e as pendências. Em caso de dúvida financeira, não invente regra: implemente bloqueio/revisão humana e documente a necessidade de configuração. Não apresente login dev, MockAI, MockWhatsApp ou PGlite local como serviços de produção homologados.
