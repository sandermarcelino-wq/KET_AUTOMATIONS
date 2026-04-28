# Marketing Research Agent Skill

## Propósito

Recebe um nicho de negócio ou tópico como input e gera inteligência de marketing estruturada que o resto do pipeline pode consumir diretamente.

Usa Tavily web research para analisar tendências de mercado, mensagem de concorrentes e interesses da audiência. O output é dados estruturados machine-readable, não apenas texto.

---

## Pipeline Position

```
User Prompt → Marketing Research Agent → research_output.json → [Ad Creative Designer | Video Ad Specialist | Copywriter Agent]
```

O Research Agent atua como a camada estratégica — produz insights de campanha que alimentam todos os creative assets gerados depois.

---

## Input Requirements

| Input | Exemplo |
|-------|---------|
| Nicho / Tópico | Automação com N8N para freelancers |
| Produto | Kit Definitivo N8N |
| Audiência | Freelancers e donos de agência |
| Plataformas alvo | Instagram, YouTube |

---

## Processo de Research

1. Usar **Tavily search** para analisar:
   - Tendências de mercado no nicho
   - Mensagem dos concorrentes
   - Interesses e linguagem da audiência
   - Hooks que performam bem na plataforma

2. Organizar resultados em campos estruturados

3. Exportar como JSON para consumo pelos agentes downstream

---

## Output Format

Salvar em: `outputs/<task_name>_<date>/research/research_output.json`

```json
{
  "niche": "automação com n8n",
  "product": "Kit Definitivo N8N",
  "audience": "freelancers e donos de agência",
  "content_topics": [
    "Como automatizar clientes com N8N",
    "Templates prontos vs construir do zero",
    "ROI de automação para agências"
  ],
  "content_angles": [
    "Para de Construir do Zero",
    "O mesmo sistema que eu vendo por R$7.500",
    "Copia e Cola"
  ],
  "keywords": [
    "n8n brasil",
    "automação freelancer",
    "templates n8n prontos",
    "agência de automação"
  ],
  "ad_hooks": [
    "Você ainda constrói do zero?",
    "88 templates testados em produção",
    "Quanto tempo você perdeu hoje?"
  ],
  "video_concepts": [
    "Demo rápida: instalar template em 60 segundos",
    "Antes vs depois: construir manual vs template",
    "Quanto eu cobro por isso"
  ]
}
```

---

## Rules

1. Sempre executar antes dos outros agentes no pipeline (exceto quando `skip_research` estiver ativo)
2. Output deve ser JSON válido e salvo na pasta correta
3. Se `skip_research` estiver ativo, confirmar que `assets/<task_name>/` existe com source folder
4. Nunca retornar apenas texto — sempre estruturar o output em campos consumíveis
