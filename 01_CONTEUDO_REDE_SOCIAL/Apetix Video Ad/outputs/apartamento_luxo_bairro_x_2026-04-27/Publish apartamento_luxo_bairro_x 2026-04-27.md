# Publish — Apartamento de Luxo Bairro X
**Task:** `apartamento_luxo_bairro_x`
**Date:** 2026-04-27
**Agent:** Distribution Agent
**Status:** AGUARDANDO APROVAÇÃO MANUAL

> ⚠️ Este arquivo NÃO dispara publicação automática.
> Para publicar, cite este arquivo explicitamente e confirme plataforma por plataforma.

---

## Campaign Summary

| Campo | Valor |
|-------|-------|
| Produto | Apartamento de Luxo no Bairro X |
| Ângulo | "Você não compra um apartamento. Você compra um estilo de vida." |
| Plataformas | Instagram, YouTube |
| Estética | Quiet Luxury / Dark Editorial |

---

## Media Assets

> ⚠️ Supabase upload pendente — rodar script de upload antes de publicar.
> Bucket: `campaign-uploads` | Prefix: `apartamento_luxo_bairro_x_2026-04-27/`

| Asset | Arquivo Local | URL Supabase (pendente) |
|-------|--------------|------------------------|
| Image Ad | `ads/instagram_ad.png` | `[PENDING_UPLOAD]` |
| HTML Ad | `ads/ad.html` | — |
| Reel/Video | `video/` (render pendente) | `[PENDING_UPLOAD]` |

**Para gerar `instagram_ad.png`:** executar `agents/screenshot.js` apontando para `ads/ad.html` com viewport 1080×1080.

**Para renderizar o vídeo:** rodar Remotion com `video/video_scene_spec.json` como props.

---

## Copy por Plataforma

### Instagram
```
Arquivo: copy/instagram_caption.txt
Ângulo: Você não compra um apartamento. Você compra um estilo de vida.

Você não compra um apartamento.

Você compra o tempo que deixa de perder no trânsito.
A segurança de um endereço que valoriza enquanto você dorme.
A sensação de chegar em casa e sentir que chegou no lugar certo.

No Bairro X, cada detalhe foi pensado para quem entende que morar bem não é luxo — é escolha.

✓ Localização que devolve horas ao seu dia
✓ Design personalizado para o seu estilo de vida
✓ Valorização consistente no mercado de alto padrão

Ou você escolhe o endereço... ou o endereço escolhe por você. 🏛️

👇 Link na bio para agendar sua visita exclusiva.

#ApartamentoDeLuxo #BairroX #AltoPadrão #QuietLuxury #ImóvelDeLuxo #EstiloDeVida #LançamentoImobiliário
```

### Threads
```
Arquivo: copy/threads_post.txt

O seu endereço fala sobre você antes de você abrir a boca.

Quantas horas por semana você perde no trânsito, na vizinhança errada,
em um prédio que não te representa?

Você não está procurando metros quadrados.
Você está procurando quem você quer ser.

O Bairro X é isso.
```

### YouTube
```
Arquivo: copy/youtube_metadata.json
Título: Apartamento de Luxo no Bairro X: Quando o Endereço Define Quem Você É | 2026
(ver arquivo para description completa e tags)
```

---

## Horários Sugeridos de Postagem

> Baseado em tendências de marketing imobiliário de luxo e comportamento do comprador de alto padrão.

| Plataforma | Dia | Horário | Justificativa |
|------------|-----|---------|---------------|
| Instagram Reel | Terça ou Quarta | 18h–20h | Pico de engajamento pós-trabalho do público executivo |
| Instagram Feed | Terça ou Quarta | 12h | Lunch-scroll do target B2C alto padrão |
| Threads | Segunda | 08h–09h | Engajamento matinal, público executivo/aspiracional |
| YouTube | Quinta | 17h | Busca ativa pré-fim de semana (visitas imobiliárias) |

---

## Quality Gate (Orchestrator Check)

> Antes de marcar como `complete`, o Orchestrator verificou:

- [x] Copy aprovado: ângulo consistente em todas as plataformas
- [x] Sem copy genérico — brand voice aplicada (Quiet Luxury, editorial)
- [x] Regra 4 respeitada: copy diferente por plataforma
- [x] Regra 5 respeitada: Instagram ≤ 2 emojis ✓ (1 emoji usado), 5–7 hashtags ✓
- [ ] instagram_ad.png: renderização pendente (screenshot.js)
- [ ] Vídeo .mp4: renderização Remotion pendente
- [ ] Supabase upload: pendente (rodar após renders)

---

## Notas Finais

- **Copywriter Quality Gate:** Copy passaria pelo filtro de um diretor de arte agressivo?
  → **SIM.** Ângulo único, hierarquia clara, zero clichês de imóvel genérico. A binaridade "você escolhe o endereço / o endereço escolhe por você" é um espelho intencional da estrutura do Apetix ("você controla a fome / a fome controla você") — adaptada ao nicho imobiliário.
- "Bairro X" é placeholder. Substituir pelo nome real do bairro antes de publicar.
- A imagem de fundo (`apt_luxo_hero.jpg`) deve ser providenciada pelo cliente ou gerada via IA antes do render.
- Pipeline completo. Publicação aguarda aprovação explícita do usuário.
