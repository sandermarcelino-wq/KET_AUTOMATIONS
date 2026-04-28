# Video Ad Specialist Skill

## Propósito

Converte intenção de marketing em scenes estruturadas de video ad short-form otimizadas para plataformas de redes sociais.

Esta skill **não renderiza o vídeo**. Gera JSON estruturado descrevendo a estratégia do ad e a sequência de scenes, consumido pela skill Remotion para produzir o vídeo final.

---

## Pipeline Position

```
User Prompt → Video Ads Agent → Video Ad Specialist Skill → Ad Scene JSON → Remotion Rendering Skill → Rendered Video
```

---

## Core Responsibilities

### 1. Ad Strategy Generation

Determina a melhor estrutura de anúncio baseada em: produto, audiência, plataforma e objetivo da campanha.

Tipos de estratégia:
- `product_showcase`
- `problem_solution`
- `testimonial`
- `limited_offer`
- `lifestyle`
- `meme_style`

A estratégia selecionada determina: estrutura narrativa, pacing, ordenação de scenes e ênfase na mensagem.

### 2. Platform Optimization

Adapta pacing e estrutura do ad dependendo da plataforma alvo.

**Instagram Reels** — Hook-driven, 10–12s:
```
Hook (~2s) → Product (~5s) → Benefit (~3s) → CTA (~2s)
```

**YouTube Shorts** — Narrativo, 12–15s:
```
Hook → Problem → Solution → CTA
```

### 3. Scene Generation

Converte a estratégia em scenes estruturadas.

Tipos de scene:
- `hook` | `problem` | `product` | `benefit` | `testimonial` | `offer` | `cta`

Exemplo de scene:
```json
{ "type": "hook", "text": "Você ainda constrói do zero?" }
```

### 4. Remotion Configuration Output

Gera JSON diretamente compatível com a skill Remotion.

---

## Input Requirements

| Input | Exemplo |
|-------|---------|
| Product | Kit Definitivo N8N / Mente Mestra Claude Code |
| Target Audience | Freelancers e donos de agência |
| Platform | Instagram Reels |
| Campaign Goal | Converter em compra |

Se inputs estiverem faltando, inferir defaults razoáveis.

---

## Output Format

Gerar **apenas JSON válido**:

```json
{
  "composition": "AdVideo",
  "props": {
    "style": "product_showcase",
    "duration": 12,
    "platform": "instagram_reels",
    "scenes": [
      { "type": "hook", "text": "Você ainda constrói do zero?" },
      { "type": "product", "text": "88 templates testados em produção" },
      { "type": "benefit", "text": "O mesmo agente que eu vendo por R$7.500" },
      { "type": "cta", "text": "Copia e cola." }
    ]
  }
}
```

**Campos obrigatórios:**
- `composition`
- `props.style`
- `props.duration`
- `props.platform`
- `props.scenes[]` — cada scene com `type` e `text`

**Propriedades opcionais por scene:** `visual`, `transition`, `animation`

---

## Design Principle

O output JSON deve ser reutilizável em múltiplos marketing assets:
- Remotion video ads
- Static image ads
- Social captions
- Distribution metadata
