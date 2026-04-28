# Ad Creative Designer Skill

## Propósito

Gera um design blueprint (layout JSON) para image ads, que um frontend renderer converte em PNG exportável. A IA cria a especificação de design, não a imagem em si.

---

## Pipeline Position

```
User Prompt → Image Ads Agent → Ad Creative Designer Skill → Layout JSON → Frontend Renderer → Export PNG
```

---

## Core Responsibilities

### Step 1–6: Layout JSON Generation

Gera especificação estruturada de design para o ad.

**Input:**
| Input | Exemplo |
|-------|---------|
| Product | Kit Definitivo N8N |
| Audience | Freelancers e donos de agência |
| Platform | Instagram (square 1080x1080) |
| Style | Editorial Terroso |

**Output — Layout JSON:**

```json
{
  "format": "instagram_square",
  "width": 1080,
  "height": 1080,
  "background": "#F5F0E8",
  "elements": [
    {
      "type": "headline",
      "text": "Para de Construir do Zero",
      "x": 80,
      "y": 120,
      "fontSize": 64
    },
    {
      "type": "subtext",
      "text": "88 Templates Testados em Produção",
      "x": 80,
      "y": 200
    },
    {
      "type": "cta",
      "text": "Copia e Cola",
      "x": 80,
      "y": 350
    },
    {
      "type": "image",
      "src": "/assets/claude_code_terminal.png",
      "x": 600,
      "y": 200,
      "width": 300
    }
  ]
}
```

**Layout templates disponíveis:**
- `product_left` | `product_right` | `centered_minimal` | `split` | `lifestyle` | `product_focus`

O agente escolhe o template — isso previne layouts feios.

**Formatos por plataforma:**
| Plataforma | Dimensões |
|------------|-----------|
| Instagram Post | 1080 × 1080 |
| Instagram Story | 1080 × 1920 |
| Instagram Feed 4:5 | 1080 × 1350 |
| YouTube Thumbnail | 1280 × 720 |

---

### Step 7: HTML Ad Rendering

Após gerar o design JSON, converte o layout em HTML advertisement renderizado.

**Gerar os arquivos:**
- `ad.html`
- `styles.css`

**Requisitos:**
- Renderizar a 1080×1080 para formato Instagram square
- Tipografia prioriza claramente: headline > subtext > CTA
- CTA deve ser visualmente distinto (button style)
- Layout deve corresponder ao template selecionado

**Estrutura HTML exemplo:**
```html
<div class="ad-container">
  <div class="headline">Para de Construir do Zero</div>
  <div class="subtext">88 templates testados em produção por R$47</div>
  <img class="product" src="claude_code_terminal.png" />
  <button class="cta">Copia e Cola</button>
</div>
```

**CSS deve enforçar:**
- `width: 1080px` / `height: 1080px`
- Espaçamento balanceado
- Layout de marketing moderno e limpo

---

### Step 8: Playwright Screenshot Rendering

Após gerar o HTML, renderizar usando Playwright.

**Processo:**
1. Lançar Chromium via Playwright
2. Set viewport para 1080×1080
3. Carregar o `ad.html` gerado
4. Aguardar imagens renderizarem
5. Capturar screenshot
6. Salvar como `instagram_ad.png`

---

### Step 9: Output Storage Rules

Todos os arquivos devem ser salvos em:

```
outputs/TASKNAME_DATE/ads/
```

**Arquivos gerados:**
- `ad.html`
- `styles.css`
- `instagram_ad.png`

Nenhum arquivo gerado fora do diretório `outputs/`.

---

## Outputs Finais

A skill produz três deliverables:
1. **Design JSON** — layout spec estruturado
2. **HTML ad layout** — `ad.html` + `styles.css`
3. **Imagem final renderizada** — `instagram_ad.png` via Playwright
