# Operação local — Etapa 0

## Inicialização e diagnóstico

Execute os comandos na raiz do projeto. Instale com `npm ci` e inicie com `npm run dev`. O painel usa porta 5173 e encaminha `/api` para a porta 3001. O servidor deve permanecer em `127.0.0.1`; não exponha o login de demonstração na internet.

Verifique a API com:

```sh
curl http://127.0.0.1:3001/api/health
```

Se o painel não carregar dados, confira o terminal da API, a porta e a sessão. Reiniciar o processo invalida sessões mantidas em memória; volte ao login. Uma mensagem de configuração insegura exige restaurar o modo simulado, não remover a proteção.

Para o painel compilado, use `npm run build` e `npm start`. Não inicie dois processos de API apontando ao mesmo diretório de banco PGlite.

## Dados e backup de demonstração

O caminho padrão é `data/construtora`, controlado por `DATA_DIR`. O seed é fictício. Não carregue dados pessoais reais antes da implementação de identidade, políticas de retenção e proteção de produção.

Para uma cópia consistente do banco local:

1. Pare a API e aguarde sua saída.
2. Copie o diretório completo para outro local privado, preservando o original.
3. Execute uma instância separada com `DATA_DIR` apontando à cópia e confira os registros pela API/painel.
4. Pare a instância de verificação antes de retomar a principal.

Exemplo de cópia com a aplicação parada:

```sh
mkdir -p backups
cp -a data/construtora backups/construtora-etapa0
DATA_DIR=./backups/construtora-etapa0 PORT=3002 npm start
```

O exemplo não substitui uma política de backup homologada. Não sobrescreva uma cópia anterior sem verificar o conteúdo. O diretório `backups/` pode conter dados; mantenha cópias fora do repositório ao trabalhar com dados futuros reais.

## Recomeçar a demonstração

Prefira apontar `DATA_DIR` a um diretório novo e vazio, preservando o existente:

```sh
DATA_DIR=./data/nova-demonstracao npm run dev
```

O novo banco receberá as migrações e dados fictícios iniciais. Não é preciso apagar dados para criar uma nova demonstração.

## Mensagens repetidas e falhas

Use o mesmo `providerMessageId` para reenviar exatamente o mesmo evento após uma falha de resposta. Não altere o conteúdo com o mesmo identificador. O servidor deve retornar o resultado já persistido ou rejeitar conflito. Um novo ID representa um novo evento; não é mecanismo de correção de uma solicitação existente.

O fluxo de convites persiste registros simulados. Não há fila de entrega Meta nem garantia de entrega externa. Uma falha deve ser investigada pela solicitação e auditoria; não interpretar `SENT_SIMULATED` como recebido pelo fornecedor.

## Importação e orçamento

Conserve uma cópia da planilha original. Exporte CSV, mapeie colunas e confira todos os erros antes de confirmar. A importação cria rascunho; congelamento é uma ação separada. Não corrija a base congelada por SQL: crie uma nova versão auditável.

## Antes de uso real

Esta versão não está habilitada para produção. As próximas entregas devem implementar e homologar identidade real, credenciais protegidas, autorização sensível, servidor PostgreSQL remoto com acesso mínimo, isolamento sob os papéis finais, backups/restauração, métricas, filas e integrações autorizadas. A presença de migrações SQL não demonstra uma implantação Supabase validada.

Sem autorização e configuração explícitas, não conecte fornecedores, WhatsApp, conta bancária, serviços de IA ou destinatários contábeis.
