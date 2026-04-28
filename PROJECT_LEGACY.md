# KET AUTOMATIONS — Manual de Bordo
**Criado em:** 2026-04-27  
**Autor:** Ket + Claude Code

---

## Visão Geral

O KET AUTOMATIONS é um sistema de três frentes integradas que automatiza o ciclo completo de marketing de performance: criação de conteúdo → atendimento de leads → gestão de anúncios. Cada frente é autônoma, mas as três se comunicam via arquivos compartilhados.

```
┌─────────────────────────────────────────────────────────────┐
│                      KET AUTOMATIONS                        │
│                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │  FRENTE 01   │    │  FRENTE 02   │    │  FRENTE 03   │  │
│  │  Conteúdo    │◄───│  WhatsApp    │    │  Gestão Ads  │  │
│  │  Rede Social │    │  Atendimento │    │  Tráfego     │  │
│  └──────┬───────┘    └──────────────┘    └──────┬───────┘  │
│         │                  ▲                     │          │
│         │   knowledge/     │          briefing   │          │
│         └──────────────────┘◄────────────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

---

## Estrutura de Pastas

```
KET_AUTOMATIONS/
│
├── PROJECT_LEGACY.md                     ← Este arquivo
│
├── 01_CONTEUDO_REDE_SOCIAL/
│   └── Apetix Video Ad/
│       ├── agents/                       ← Scripts de execução de cada agente
│       │   ├── research.ts               ← Pesquisa de mercado (web search)
│       │   ├── generate_appetix.js       ← Geração de conteúdo Appetix
│       │   └── screenshot.js             ← Renderiza ad.html → instagram_ad.png
│       ├── src/                          ← Componentes Remotion (vídeo)
│       │   ├── Composition.tsx
│       │   ├── Grelina.tsx               ← Vídeo do hormônio grelina
│       │   └── LuxuryApt.tsx             ← Vídeo apartamento de luxo
│       ├── .claude/skills/               ← Skills dos agentes (system prompts)
│       │   ├── orchestrator.md           ← Coordena todos os agentes
│       │   ├── marketing-research-agent.md
│       │   ├── copywriter-agent.md
│       │   ├── ad-creative-designer.md
│       │   ├── video-ad-specialist.md
│       │   └── distribution-agent.md
│       └── outputs/                      ← Um subpasta por job/campanha
│           └── {job_name}_{data}/
│               ├── job_payload.json
│               ├── research/research_output.json
│               ├── copy/                 ← Legendas por plataforma
│               ├── ads/                  ← HTML + imagem do anúncio
│               ├── video/                ← Spec de vídeo + .mp4 renderizado
│               └── Publish *.md          ← Checklist de publicação manual
│
├── 02_ATENDIMENTO_WHATSAPP/
│   ├── whatsapp_receiver.js              ← Servidor webhook principal (Node.js)
│   ├── test_prompt_dry_run.mjs           ← Validação sem chamar API
│   ├── package.json
│   ├── .claude/skills/
│   │   └── whatsapp-closer-agent.md      ← Persona SDR de alta performance
│   └── knowledge/                        ← Base de conhecimento por nicho
│       ├── imobiliaria_info.md           ← Jardins: diferenciais, preços, objeções
│       ├── suplementos_catalogo.md       ← Appetix: mecanismo, preços, objeções
│       └── educacao_digital.md           ← Cursos: perfis, preços, objeções
│
└── 03_GESTAO_ADS/
    ├── analyze_ads.py                    ← Script de análise diária (Python)
    ├── requirements.txt
    ├── .claude/skills/
    │   └── ads-manager-agent.md          ← Regras CPA / CTR / escala
    └── reports/
        ├── daily_performance.json        ← Input: métricas brutas do dia
        ├── actions_to_take.json          ← Output: decisões PAUSE/SCALE/MAINTAIN/RECREATE
        └── briefing_for_frente_1.txt     ← Output: gerado apenas quando há RECREATE
```

---

## Frente 01 — Conteúdo para Rede Social

**Pasta:** `01_CONTEUDO_REDE_SOCIAL/Apetix Video Ad/`  
**Stack:** Node.js + TypeScript + Remotion

### Pipeline de Agentes (em sequência)

```
job_payload.json
      │
      ▼
marketing-research-agent  →  research_output.json
      │
      ▼
copywriter-agent          →  copy/ (instagram, threads, youtube)
      │
      ▼
ad-creative-designer      →  ads/layout.json + ad.html
      │
      ▼
video-ad-specialist       →  video/video_scene_spec.json
      │
      ▼
screenshot.js             →  ads/instagram_ad.png
      │
      ▼
Remotion render           →  video/instagram_video.mp4
      │
      ▼
distribution-agent        →  Publish *.md (checklist de publicação)
```

### Como rodar uma nova campanha

```bash
cd "01_CONTEUDO_REDE_SOCIAL/Apetix Video Ad"
npm install

# 1. Criar job_payload.json com product, niche, audience, platform_targets
# 2. Rodar o agente via Claude Code apontando para o orchestrator
# 3. Para renderizar o vídeo:
npx remotion render src/index.ts VideoAd outputs/{job}/video/output.mp4

# 4. Para gerar o screenshot do ad HTML:
node agents/screenshot.js outputs/{job}/ads/ad.html outputs/{job}/ads/instagram_ad.png
```

### Variáveis de ambiente (`.env`)

```
ANTHROPIC_API_KEY=sk-...
SUPABASE_URL=...
SUPABASE_KEY=...
```

---

## Frente 02 — Atendimento WhatsApp

**Pasta:** `02_ATENDIMENTO_WHATSAPP/`  
**Stack:** Node.js ESM + Express + Redis + Anthropic SDK

### Como funciona

```
Mensagem WhatsApp
      │
      ▼
POST /webhook/whatsapp
      │
      ├── Extrai phone (normaliza DDI 55 → número local)
      │   Ex: "5535998247070" → "35998247070"
      │
      ├── Busca histórico no Redis: chat:{phone}  (TTL 24h, máx 20 turnos)
      │
      ├── Monta system prompt:
      │   whatsapp-closer-agent.md  +  knowledge/*.md
      │
      ├── Chama Claude API (claude-sonnet-4-6, max 300 tokens)
      │
      ├── Salva nova mensagem + resposta no Redis
      │
      └── Retorna { phone, reply, transferToHuman: bool }
            └── Se reply contém [TRANSFER_TO_HUMAN] → flag true
```

### Como rodar

```bash
cd 02_ATENDIMENTO_WHATSAPP
npm install

# Configurar variáveis de ambiente
export ANTHROPIC_API_KEY=sk-...
export REDIS_URL=redis://localhost:6379   # ou Redis Cloud
export PORT=3000                          # opcional, default 3000

node whatsapp_receiver.js
```

### Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/webhook/whatsapp` | Recebe mensagens (Evolution API / Z-API) |
| GET | `/health` | Health check |

### Payload esperado (Evolution API)

```json
{
  "data": {
    "key": { "remoteJid": "5535998247070@s.whatsapp.net" },
    "message": { "conversation": "Qual o diferencial dos Jardins?" }
  }
}
```

### Validar sem gastar API

```bash
node test_prompt_dry_run.mjs
# Verifica: Jardins, LAVVI, objeções, gatilhos, normalização de telefone
```

### Atualizar a base de conhecimento

Editar diretamente os arquivos em `knowledge/`:
- `imobiliaria_info.md` — produto **Jardins** (Apartamento de Luxo)
- `suplementos_catalogo.md` — produto **Appetix** (controle de apetite)
- `educacao_digital.md` — **Cursos / Mentorias digitais**

Estrutura padrão de cada arquivo: `# Descrição` → `# Tabela de Preços` → `# Objeções`

---

## Frente 03 — Gestão de Ads / Tráfego

**Pasta:** `03_GESTAO_ADS/`  
**Stack:** Python 3 + Anthropic SDK

### Como funciona

```
daily_performance.json  (métricas brutas do Meta Ads)
      │
      ▼
analyze_ads.py
      │
      ├── Carrega ads-manager-agent.md como system prompt (prompt caching)
      │
      ├── Envia métricas brutas para Claude (sem agent_decision pré-preenchido)
      │
      ├── Claude aplica Matriz de Decisão:
      │   ├── CPA > cpa_limit?  → PAUSE
      │   ├── CPA < limit AND ROAS > 3?  → SCALE (+20% budget)
      │   ├── CTR < 1% em vídeo?  → RECREATE + alert_creative_team: true
      │   └── demais  → MAINTAIN
      │
      ├── Salva → reports/actions_to_take.json
      │
      └── Se RECREATE: 2º call → reports/briefing_for_frente_1.txt
```

### Limites de CPA por nicho

| Nicho | CPA Limite |
|-------|-----------|
| Imobiliária | R$ 80,00 |
| Suplementos | R$ 60,00 |
| Educação | R$ 120,00 |

### Como rodar

```bash
cd 03_GESTAO_ADS
pip install -r requirements.txt

export ANTHROPIC_API_KEY=sk-...

# Atualizar reports/daily_performance.json com dados do dia
# (exportar do Meta Ads Manager ou via API)

python analyze_ads.py
```

### Outputs gerados

| Arquivo | Gerado quando |
|---------|--------------|
| `reports/actions_to_take.json` | Sempre |
| `reports/briefing_for_frente_1.txt` | Apenas quando há anúncio com `RECREATE` |

---

## Como as Frentes se Comunicam

### 1. Frente 01 → Frente 02 (Criação alimenta Atendimento)

Quando um novo produto é lançado na Frente 01 (nova campanha gerada), os dados de pesquisa e copy devem ser extraídos e atualizados nos arquivos de knowledge da Frente 02.

```
01/outputs/{campanha}/research/research_output.json
         │
         ▼  (atualização manual ou via script)
02/knowledge/{nicho}.md
```

### 2. Frente 03 → Frente 01 (Performance alimenta Criativo)

Quando `analyze_ads.py` detecta um hook com CTR < 1%, ele gera automaticamente um briefing para a equipe criativa.

```
03/reports/briefing_for_frente_1.txt
         │
         ▼  (equipe criativa lê e cria novo job_payload.json)
01/outputs/{nova_campanha}/
```

### 3. Frente 02 ↔ Frente 03 (Mesmo produto, dados compartilhados)

Ambas as frentes trabalham com os mesmos produtos (Jardins, Appetix, Educação). A `knowledge/` da Frente 02 é a fonte de verdade de preços e diferenciais — a Frente 03 usa esses dados como referência ao criar briefings de novos criativos.

---

## Variáveis de Ambiente (consolidado)

| Variável | Frente | Obrigatório | Descrição |
|----------|--------|-------------|-----------|
| `ANTHROPIC_API_KEY` | 01, 02, 03 | Sim | Chave API Anthropic |
| `REDIS_URL` | 02 | Sim | Ex: `redis://localhost:6379` |
| `PORT` | 02 | Não | Default: `3000` |
| `SUPABASE_URL` | 01 | Para upload | URL do projeto Supabase |
| `SUPABASE_KEY` | 01 | Para upload | Chave anon do Supabase |

---

## Skills (System Prompts) dos Agentes

| Arquivo | Frente | Persona |
|---------|--------|---------|
| `orchestrator.md` | 01 | Coordena o pipeline de criação |
| `marketing-research-agent.md` | 01 | Pesquisa de mercado e concorrentes |
| `copywriter-agent.md` | 01 | Copy para Instagram, Threads, YouTube |
| `ad-creative-designer.md` | 01 | Layout visual dos anúncios |
| `video-ad-specialist.md` | 01 | Roteiro e cenas de vídeo (Remotion) |
| `distribution-agent.md` | 01 | Checklist de publicação por plataforma |
| `whatsapp-closer-agent.md` | 02 | SDR de alta performance (fechamento) |
| `ads-manager-agent.md` | 03 | Media buyer / gestor de tráfego |

---

## Próximos Passos Sugeridos

- [ ] Conectar `analyze_ads.py` à API do Meta Ads para popular `daily_performance.json` automaticamente
- [ ] Criar script que lê `actions_to_take.json` e executa pausas/escalas via Meta API
- [ ] Adicionar webhook de notificação (Slack/Telegram) quando um anúncio for pausado
- [ ] Automatizar a transferência `briefing_for_frente_1.txt` → novo `job_payload.json`
- [ ] Adicionar suporte a Z-API no `whatsapp_receiver.js` para envio ativo de respostas
- [ ] Configurar Redis Cloud para persistência do histórico de conversas em produção
