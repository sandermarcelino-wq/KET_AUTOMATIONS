# Instruções permanentes de projeto — Construtora IA

Leia `docs/SPEC.md` antes de alterações. A especificação é a fonte de verdade funcional e de segurança. Esta entrega implementa as Etapas 0 e 1; preserve o documento fornecido e registre decisões em `docs/ADR/`.

Implemente uma etapa por vez e mantenha o modo simulado até autorização explícita. Preserve orçamento-base, registro de preço autorizado e trilha de auditoria; não realize compras, pagamentos, mensagens reais nem alterações bancárias sem configuração e testes. No MVP, somente o proprietário aprova cada compra; preço autorizado e aprovação de compra são controles distintos. Essas aprovações estão implementadas na Etapa 1 (`apps/api/src/purchasing.ts`, migração 003); qualquer mudança de regra exige teste e ADR.

Use validações determinísticas, idempotência e isolamento por tenant. Nunca derive permissões de `tenant_id` enviado no corpo da requisição. Preserve as restrições de banco e o bloqueio a alterações de versões congeladas. Não converta dinheiro para ponto flutuante nos cálculos de domínio.

Atualize testes, `README.md`, `CHANGELOG.md` e decisões de arquitetura a cada mudança de regra. Execute `npm test`, `npm run typecheck`, `npm run lint` e `npm run build` quando afetados. Nunca insira segredos no repositório. Indique com clareza o que é real, simulado, pendente ou não comprovado. O login dev serve somente à demonstração local; não o publique como autenticação real.
