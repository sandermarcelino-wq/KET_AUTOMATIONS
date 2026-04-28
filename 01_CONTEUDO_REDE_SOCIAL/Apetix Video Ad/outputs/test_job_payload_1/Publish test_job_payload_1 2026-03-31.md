# Publish test_job_payload_1 — 2026-03-31

> ⚠ **DRY-RUN** — Nenhum conteúdo foi publicado. Este é um teste de pipeline completo.
> Execute posting somente após remover o flag `dry_run: true` do Job Payload e confirmar explicitamente.

---

## Pipeline Status

| Agent | Status | Output |
|-------|--------|--------|
| Research Agent | ✅ complete | `research/research_output.json` |
| Ad Creative Designer | ✅ complete | `ads/layout.json` · `ads/ad.html` · `ads/styles.css` |
| Video Ad Specialist | ✅ complete | `video/video_ad_scenes.json` |
| Copywriter Agent | ✅ complete | `copy/instagram_caption.txt` · `copy/threads_post.txt` · `copy/youtube_metadata.json` |
| Distribution Agent | ✅ complete | Este arquivo |

---

## Media Files

### Static Ad

| File | Placeholder URL |
|------|----------------|
| `ads/ad.html` | `https://campaign-uploads.supabase.co/storage/v1/object/public/campaign-uploads/test_job_payload_1/ads/ad.html` |
| `ads/styles.css` | `https://campaign-uploads.supabase.co/storage/v1/object/public/campaign-uploads/test_job_payload_1/ads/styles.css` |
| `ads/instagram_ad.png` | `https://campaign-uploads.supabase.co/storage/v1/object/public/campaign-uploads/test_job_payload_1/ads/instagram_ad.png` |

> `instagram_ad.png` — gerado via Playwright screenshot (pendente instalação do Playwright).

### Video Ad

| File | Placeholder URL |
|------|----------------|
| `out/appetix-ad.mp4` | `https://campaign-uploads.supabase.co/storage/v1/object/public/campaign-uploads/test_job_payload_1/video/appetix-ad.mp4` |
| `video/video_ad_scenes.json` | `https://campaign-uploads.supabase.co/storage/v1/object/public/campaign-uploads/test_job_payload_1/video/video_ad_scenes.json` |

> Para renderizar: `npm run render`

---

## Campaign Angle

**"Você não tem fome. Você está sendo controlado."**

Usado consistentemente em Instagram, Threads e YouTube.

---

## Instagram

**Caption:**

```
Você não tem fome.

Você está sendo controlado pelo seu apetite desregulado.

Vontade de comer toda hora. Ansiedade à noite. Compulsão fora de controle.

O problema não é você. É a sua bioquímica.

Apetix regula isso.

✓ Menos fome
✓ Mais controle
✓ Clareza mental

Efeito parecido com canetas emagrecedoras — por menos da metade do preço.

Ou você controla a fome, ou ela controla você.

👇 Link na bio para começar.

#Apetix #ControleDeApetite #EmagrecimentoReal #CompulsaoAlimentar #SuplementoNatural #EmagrecimentoBrasil #ControleReal
```

**Media:** `instagram_ad.png` (1080×1080) + `appetix-ad.mp4` (9:16, 15s)

**Horário recomendado:**
- Terça, Quarta ou Quinta
- 12h–14h ou 19h–21h (ET → considerar horário BR: +1h ET)
- Evitar Sexta à noite e fim de semana pela manhã

---

## YouTube

**Título:** `Apetix: Controle de Apetite Real (Alternativa às Canetas Emagrecedoras) | 2025`

**Description:** ver `copy/youtube_metadata.json`

**Tags:** `controle de apetite` · `suplemento emagrecimento` · `ozempic natural` · `alternativa ozempic` · `Apetix` · + 9 tags (ver JSON)

**Horário recomendado:**
- Sábado ou Domingo 10h–12h
- Ou Terça/Quarta 18h–20h

---

## Threads

```
Você não tem fome.

Você está sendo controlado pelo seu próprio apetite desregulado.

Apetix resolve isso — sem caneta, sem preço absurdo.
```

---

## Scheduling Notes

- Lançar **Instagram Reel primeiro** (maior alcance imediato para o nicho)
- Publicar **YouTube Shorts** 24–48h depois para capturar busca orgânica
- **Threads** no mesmo dia do Instagram, 1–2h depois como reforço
- Não publicar todos os formatos no mesmo horário exato

---

## Next Steps

- [ ] Instalar Playwright e gerar `instagram_ad.png` a partir de `ad.html`
- [ ] Rodar `npm run render` para gerar `appetix-ad.mp4`
- [ ] Fazer upload real para Supabase bucket `campaign-uploads`
- [ ] Substituir placeholder URLs neste MD pelas URLs reais
- [ ] Confirmar publicação citando este arquivo para triggerar o Distribution Agent

---

*Gerado pelo Distribution Agent — Pipeline test_job_payload_1 — 2026-03-31*
*⚠ DRY-RUN: nenhum conteúdo publicado automaticamente*
