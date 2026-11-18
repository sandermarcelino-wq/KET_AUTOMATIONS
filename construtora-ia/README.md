# Construtora IA — Etapas 0 e 1

Central de administração de obras com painel em português e simulador local de pedidos de materiais. Esta entrega implementa **a Etapa 0** (cadastros, orçamento-base versionado, importação assistida, convites de cotação simulados) e **a Etapa 1** (propostas de fornecedores, comparação, teto de preço evolutivo, aprovação exclusiva do proprietário e pedidos), tudo em modo simulado.

**Todos os dados iniciais são fictícios. `DRY_RUN` permanece ligado.** A aplicação não envia mensagens a fornecedores, não contrata compras reais e não movimenta dinheiro; os “pedidos” da Etapa 1 são registros locais simulados. O login permite escolher um perfil de demonstração; não é autenticação de produção.

## Executar localmente

Requisitos: Node.js 22 ou superior e npm. Não é necessário Docker, conta no Supabase ou credenciais de WhatsApp/IA.

```sh
npm ci
npm run dev
```

Abra **http://127.0.0.1:5173**. A API usa **http://127.0.0.1:3001**. Na tela inicial, escolha a organização de demonstração e o perfil **Proprietário**. Mantenha os servidores em endereço local; o login de desenvolvimento não deve ser publicado na internet.

As variáveis disponíveis estão em [`.env.example`](.env.example). Os valores padrão bastam para a demonstração. Se desejar, copie esse arquivo para `.env`; a API lê o arquivo na raiz. Variáveis já definidas no terminal têm precedência. Para alterar uma variável no terminal, por exemplo:

```sh
PORT=3001 DATA_DIR=./data/construtora npm run dev
```

Novo na Etapa 1: `MIN_COMPARABLE_QUOTES` (padrão 2) define quantas propostas comparáveis dispensam o aviso de comparação limitada.

O banco PostgreSQL embarcado PGlite grava os dados em `data/construtora`. As migrações e a carga inicial são aplicadas pela API. Reiniciar preserva os dados desse diretório; os testes usam bancos isolados em memória e diretórios temporários.

Para executar o painel compilado pela API:

```sh
npm run build
npm start
```

Abra **http://127.0.0.1:3001**. Não use `NODE_ENV=production`: esta versão bloqueia operação em produção e `DRY_RUN=false`.

## Demonstração

1. Entre como **Proprietário**. A empresa principal contém a obra Residencial Aurora, cinco fornecedores e dez materiais fictícios, além de um orçamento-base congelado.
2. Em **Cadastros**, crie dois fornecedores de teste com a categoria do material desejado e consentimento marcado. Telefones devem estar no formato E.164, por exemplo `+5500000000101`; nenhum número é contatado.
3. No **Simulador**, selecione a obra e um contato autorizado. Envie `Preciso de 100 sacos de cimento CP II 50 kg daqui 2 dias`. A opção de áudio recebe uma **transcrição digitada**, sem gravar ou transcrever áudio real.
4. Confira o material, a quantidade e a data extraídos. Se faltar informação, complete o esclarecimento solicitado. Gere os convites de cotação e consulte as mensagens marcadas como simuladas. Nenhum preço é inventado e nenhum pedido de compra é gerado.
5. Em **Orçamento**, importe uma planilha exportada para CSV, mapeie as colunas, revise a prévia e confirme a criação de um rascunho. Congele a versão somente após conferir os itens. A versão congelada permanece preservada.
6. **Etapa 1 — compras.** Em **Compras → Cotações**, use “Registrar resposta de fornecedor (simulada)” para cada fornecedor (texto livre como “CP II a R$ 32,00 o saco, frete R$ 150, entrego em 2 dias, à vista” ou campos). Proposta sem preço, frete, prazo ou pagamento fica *incomparável*. Encerre a cotação, escolha a proposta (a recomendada é a menor que cumpre o prazo) e **Preparar pedido** — isso não autoriza nada. Em **Aprovações**, o proprietário aprova a compra; se o preço superar o teto (inicialmente o preço do orçamento-base, R$ 30), é preciso também autorizar o novo teto, em checkbox separado. Em **Pedidos**, simule a resposta do fornecedor: confirmar os mesmos termos, propor alteração (reabre a aprovação), indisponível ou sem resposta. **Preços e desvios** mostra orçamento original, último comprado, cotado, teto e histórico; aumentos continuam aparecendo mesmo dentro do teto.
7. Consulte as solicitações e a auditoria. Entre com o perfil **Escritório** para verificar a consulta sem edição, ou **Encarregado** para observar o acesso limitado às obras autorizadas.

Uma demonstração automatizada do fluxo também está disponível:

```sh
npm run demo
```

## Importação de orçamento

A Etapa 0 aceita **CSV**, exportável pelo Excel, LibreOffice e Google Sheets. Não modifica o arquivo de origem. O cadastro de materiais define as unidades comerciais; materiais desconhecidos, unidades incompatíveis e valores inválidos precisam ser corrigidos antes de importar. Mapeie os nomes das colunas quando sua planilha tiver cabeçalhos diferentes.

Cabeçalhos padrão:

```csv
material,unidade,quantidade,preco_unitario
Cimento CP II 50 kg,saco 50 kg,1000,30.00
```

Use o nome e a unidade **exatos do cadastro exibido na aplicação**. O exemplo corresponde ao material do seed. Há confirmação humana separada para importar e congelar. Quantidades e preços são transmitidos como strings decimais; o domínio usa aritmética decimal e o banco valida os valores e somas com `numeric`.

Importação nativa XLSX, PDFs de contratos e extratos bancários pertencem a expansões posteriores; não estão presentes nesta entrega.

## Comandos de verificação

```sh
npm test
npm run typecheck
npm run lint
npm run build
npm run demo
```

Consulte [o plano de testes](docs/TEST_PLAN.md) para os critérios, a cobertura e as limitações. O comando de testes deve ser executado no checkout instalado; a existência de um cenário no plano não significa que ele tenha sido homologado em produção.

## O que é implementado e o que é simulado

| Área | Situação nesta entrega |
|---|---|
| Cadastros e orçamento | API, validação, persistência local, versões e congelamento |
| Isolamento de organizações e perfis | Verificação no servidor e restrições no banco; identidade escolhida em login dev |
| Mensagens e convites | Registros locais simulados, com controle de repetição |
| Propostas, comparação e urgência | Respostas simuladas, total comparável (preço + frete + custos), prazo, desvios; interpretador de regras (não IA) |
| Teto de preço e aprovações | Teto por obra+material+condição de pagamento, histórico, aprovação exclusiva do proprietário ligada à versão/hash do pedido; gatilhos no banco |
| Pedidos ao fornecedor | Mensagem formal simulada com o aviso de não faturar se houver alteração; confirmação, alteração, indisponibilidade e sem resposta |
| Interpretação de pedido | `MockAI` determinístico; suporte limitado a exemplos e esclarecimento humano |
| WhatsApp | `MockWhatsApp`; sem Meta Cloud API ou envio externo |
| Áudio | Texto já transcrito; sem reconhecimento de fala |
| Armazenamento de arquivos | Adaptador `MockStorage`; sem serviço de mídia ou URLs de produção |
| PostgreSQL | PGlite embarcado no processo Node, com migrações SQL; sem conexão remota Supabase |
| Recebimento por foto, Pix, comprovantes e cheques | Etapa 2, não implementados (condições de pagamento são apenas registradas) |
| Apartamentos e fluxo de caixa | Etapa 3; apenas [massa ilustrativa](docs/examples/apartamentos-futuros.json), sem lançamentos |
| Meta, IA externa, conciliação e contabilidade | Etapa 4, não integradas |
| SaaS comercial | Etapa 5, não disponível |

Não são necessárias credenciais externas para esta etapa. A execução local usa recursos da máquina. Futuras integrações e hospedagem podem gerar custos próprios; esta entrega não promete franquias gratuitas ou disponibilidade contínua.

## Organização do código

```text
apps/api/                 Hono, autenticação dev, APIs (app.ts, purchasing.ts) e servidor local
apps/admin/               Painel React/Vite
packages/domain/          Regras determinísticas e importação
packages/integrations/    Adaptadores simulados
packages/database/        Banco, migrações e dados fictícios
packages/shared/          Tipos e contrato entre aplicação e API
tests/                    Testes de domínio e integração
scripts/                  Demonstração executável
docs/                     Especificação, decisões, operação e testes
```

Decisões da Etapa 1: [ADR 0003](docs/ADR/0003-compras-e-aprovacoes.md). A [especificação fornecida](docs/SPEC.md) permanece como fonte funcional. As [decisões de arquitetura](docs/ADR/0001-etapa-zero-local.md) registram as escolhas da Etapa 0. Para operação e recuperação, leia o [runbook](docs/RUNBOOK.md). As etapas seguintes precisam ser desenvolvidas e testadas antes de qualquer uso real.
