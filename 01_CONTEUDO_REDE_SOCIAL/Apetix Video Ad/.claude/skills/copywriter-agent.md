# Copywriter Agent Skill

## Propósito

Gera copy de marketing por plataforma, alinhado com brand voice, research outputs e um único ângulo de campanha consistente.

---

## Pipeline Position

```
Research Agent → Copywriter Agent → [threads_post.txt | instagram_caption.txt | youtube_metadata.json]
```

---

## Regras Operacionais

### Regra 1 — Sempre Referenciar Knowledge Files

Antes de gerar qualquer copy, revisar arquivos relevantes em `knowledge/`:

- `knowledge/brand_identity.md`
- `knowledge/product_campaign.md`
- `knowledge/platform_guidelines.md`

Alinhar todo copy com: brand voice, product positioning, estilo de CTA, prioridades de mensagem.

**Se houver conflito entre copy genérico e brand guidelines, brand guidelines têm prioridade.**

---

### Regra 2 — Referenciar Research Outputs Quando Disponíveis

Se um research output existir, extrair de `outputs/<task_name>_<date>/research/research_output.json`:

- `content_topics`
- `content_angles`
- `keywords`
- `ad_hooks`
- `video_ideas`

Estes devem influenciar: hooks de mensagem, copy por plataforma, hashtags, YouTube tags.

---

### Regra 3 — Consistência de Campanha

Selecionar **um único ângulo de campanha** do research output e mantê-lo consistente em todas as plataformas.

Exemplo:
> Ângulo: "Para de Construir do Zero" → deve aparecer em Threads, Instagram e YouTube

---

### Regra 4 — Adaptação por Plataforma

| Plataforma | Estilo |
|------------|--------|
| Threads | Curto, conversacional, provocativo |
| Instagram | Editorial + CTA desafiador |
| YouTube | SEO optimized, didático |

**Nunca gerar copy idêntico entre plataformas.**

---

### Regra 5 — Seguir Platform Formatting Guidelines

Referenciar `knowledge/platform_guidelines.md`. Constraints exemplo:

**Instagram:**
- Máximo 2 emojis
- 3–5 hashtags
- CTA claro e desafiador

**Threads:**
- Short form, 1–2 parágrafos curtos
- Tom provocativo

**YouTube:**
- Título otimizado para busca
- Description inclui keywords
- Lista de tags incluída

---

### Regra 6 — Output Estruturado

```json
{
  "campaign_angle": "Para de Construir do Zero",
  "threads_post": "...",
  "instagram_caption": "...",
  "youtube": {
    "title": "...",
    "description": "...",
    "tags": ["tag1", "tag2"]
  }
}
```

---

### Regra 7 — Output Storage

Salvar em: `outputs/<task_name>_<date>/copy/`

**Arquivos:**
- `threads_post.txt`
- `instagram_caption.txt`
- `youtube_metadata.json`
