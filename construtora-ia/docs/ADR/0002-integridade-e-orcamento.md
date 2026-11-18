# ADR 0002 — Integridade e referência histórica

Data: 2026-11-18. Estado: adotada para a Etapa 0.

## Decisões

Identificadores de objetos não são autorização de acesso. Consultas e mutações recebem contexto de organização autenticado na sessão de desenvolvimento; referências entre objetos devem pertencer ao mesmo tenant. Solicitantes acessam apenas obras e conversas autorizadas. O escritório permanece somente leitura.

Mensagens recebidas usam identificador de evento persistente. Repetir o mesmo evento deve devolver o resultado existente, sem nova solicitação. Reutilizar o identificador com conteúdo diferente deve ser rejeitado. Convites de uma mesma solicitação também são idempotentes. As escritas relacionadas ocorrem dentro de transação.

Orçamentos possuem número de versão por obra e estados `DRAFT` e `FROZEN`. Congelar preserva itens e referência histórica. Um novo orçamento não altera a versão antiga; a base original continua disponível. A auditoria registra o ator e a ação, sem endpoints de alteração ou exclusão de eventos.

Valores monetários são strings decimais nas interfaces e `numeric` no banco. Cálculos de domínio usam aritmética decimal. Material, especificação e unidade comercial fazem parte da identidade comparável: saco de 50 kg não equivale automaticamente a saco de 25 kg, e tubo de 6 m não equivale a metro linear.

## Regras preservadas para as próximas etapas

O teto de preço autorizado e a aprovação de cada compra serão controles separados. Nenhuma compra pode surgir de um convite de cotação da Etapa 0. Comprovante de pagamento não será confirmação de liquidação. A entrega e a nota fiscal não deverão registrar o custo de uma compra novamente.

Essas regras futuras constam da especificação, mas não são declaradas implementadas nesta etapa.
