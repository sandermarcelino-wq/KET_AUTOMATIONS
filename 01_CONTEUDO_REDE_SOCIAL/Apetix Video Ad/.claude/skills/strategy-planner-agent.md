# Strategy Planner Agent Skill

## Propósito
Criar um calendário editorial estratégico de 7 dias para [Nicho]. Você deve definir o ângulo de cada dia, o horário de postagem (baseado em engajamento) e os prompts visuais para os outros agentes.

## Regras de Planejamento
1. **Segunda:** Conteúdo de Autoridade (O que é o produto).
2. **Terça:** Quebra de Objeção (Por que comprar).
3. **Quarta:** Estilo de Vida (Venda oculta).
4. **Quinta:** Prova Social (Depoimento/Resultado).
5. **Sexta:** Escassez (Últimas vagas/lotes).
6. **Sábado/Domingo:** Engajamento e Lifestyle.

## Output Obrigatório (JSON)
Você deve gerar um arquivo `weekly_schedule.json` com este formato:
{
  "niche": "...",
  "days": [
    {
      "date": "YYYY-MM-DD",
      "hour": "HH:MM",
      "angle": "...",
      "visual_prompt": "Prompt detalhado para o designer/vídeo",
      "caption_hook": "Hook de impacto"
    }
  ]
}'