# ADR 0001 — Etapa 0 local e simulada

Data: 2026-11-18. Estado: adotada para a Etapa 0.

## Contexto

A seção 18 e a instrução inicial do kit determinam construir somente a Etapa 0, demonstrável sem contas externas. A visão completa inclui compras e finanças, mas implementá-las agora contrariaria o recorte solicitado pelo próprio kit.

## Decisão

- Usar monorepo TypeScript em modo estrito, API Hono sobre Node.js e painel React/Vite. Node é uma alternativa expressamente admitida pela especificação e permite persistência local sem um serviço contratado.
- Usar PGlite, uma distribuição embarcada de PostgreSQL, com migrações SQL e armazenamento em disco no modo de desenvolvimento. Isso oferece transações e integridade relacional sem exigir Docker ou credenciais Supabase.
- Manter `MockAI`, `MockWhatsApp` e `MockStorage`. O simulador aceita texto e transcrição fornecida pelo usuário. Nenhum adaptador nesta etapa tem autorização ou configuração para envio real.
- Adotar login de demonstração com perfis e organizações fictícios. O servidor obtém o tenant da sessão, e não de um identificador livre enviado nas mutações. O servidor local não é uma fronteira de autenticação comercial: qualquer pessoa com acesso ao login dev pode escolher um perfil.
- Bloquear execução com `DRY_RUN=false` ou em ambiente de produção. Nenhum botão ou endpoint de compra, pagamento ou aprovação financeira é disponibilizado.
- Disponibilizar importação CSV com mapeamento, validação, prévia e confirmação. Uma versão de orçamento nasce como rascunho e é congelada em uma ação explícita separada; retificações devem gerar novas versões.
- Manter o modo demonstrativo local. Publicação com login dev permitiria a terceiros escolher identidades; uma implantação de produção depende da etapa de identidade, infraestrutura e validações apropriadas.

## Consequências e limites

PGlite usa o motor PostgreSQL, mas não constitui homologação do aplicativo em um servidor PostgreSQL/Supabase remoto, nem teste de concorrência entre vários processos. A migração para ambiente multiusuário remoto exigirá adaptador, gestão de conexões, identidade real, migrações verificadas e testes com o papel de banco de menor privilégio.

O simulador persiste solicitações e mensagens para revisão e deduplicação. Ele não representa confirmação de um fornecedor, entrega de uma mensagem ou contrato de compra. A rotina de convite local é síncrona; filas externas, retentativas e dead letters serão necessárias quando houver efeitos externos.

O mock de interpretação não é um modelo de linguagem; extração incerta pede revisão. Não há transcrição automática, análise de imagens ou leitura de documentos fiscais.

## Próxima revisão

Antes da Etapa 1, revisar estados, concorrência e regras de preço. Antes de qualquer serviço externo, revisar identidade, autorização, observabilidade, backup e recuperação no ambiente de implantação. Nunca transformar a simples alteração de uma variável em autorização para operação real.
