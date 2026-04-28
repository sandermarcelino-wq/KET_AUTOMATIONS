# Orchestrator Agent Skill

## Propósito

Recebe um Job Payload e roda o pipeline de conteúdo com IA como um único workflow coordenado. Gerencia dependências entre agentes, skips opcionais e validação de assets. Rastreia status de jobs via BullMQ + Redis.

---

## Pipeline Completo

```
Job Payload
     ↓
Orchestrator Skill
     ↓
Research Agent → Ad Creative Designer ─┐
              → Video Ad Specialist    ├─→ Copywriter Agent → Distribution Agent
              → (skips opcionais)     ─┘
```

Jobs de imagem e vídeo podem rodar em paralelo após o Research Agent.

---

## Job Payload Format

```json
{
  "task_name": "deploy_club_campaign",
  "task_date": "2026-03-31",
  "source_folder": "assets/deploy_club_campaign/",
  "user_flags": {
    "skip_research": false,
    "skip_image": false,
    "skip_video": false
  },
  "platform_targets": ["instagram", "youtube"]
}
```

---

## Instruções de Execução

1. **Receber e validar** o Job Payload
2. **Checar dependências** para cada agente:
   - Research Agent → roda primeiro, a menos que `skip_research: true`
   - Se `skip_research: true` → confirmar que `assets/<task_name>/` existe
   - Se pasta faltando → retornar: `"Task não pode prosseguir até a source folder ser uploaded"`
   - Ad Creative Designer → após research ou skip confirmado
   - Video Ad Specialist → após research ou skip confirmado (pode rodar em paralelo com Ad Designer)
   - Copywriter Agent → após research ou skip confirmado
   - Distribution Agent → por último, após todos os outputs estarem prontos
3. **Enqueue jobs** no BullMQ com dependências apropriadas
4. **Rastrear status** de conclusão para cada job
5. **Aplicar skips** opcionais: se `skip_image` ou `skip_video`, marcar job como complete sem executar
6. **Gerar logs** e summaries para cada job
7. **Notificar** quando pipeline completar ou se erros ocorrerem

---

## Job Status Format

```json
{
  "job_name": "video_ad_specialist",
  "status": "queued | running | complete | failed",
  "dependencies": ["research_agent"],
  "notes": "Pulado por flag do usuário"
}
```

---

## Pipeline Report Format

```json
{
  "task_name": "deploy_club_campaign",
  "task_date": "2026-03-31",
  "jobs": [
    { "job_name": "research_agent", "status": "complete", "dependencies": [] },
    { "job_name": "ad_creative_designer", "status": "complete", "dependencies": ["research_agent"] },
    { "job_name": "video_ad_specialist", "status": "complete", "dependencies": ["research_agent"] },
    { "job_name": "copywriter_agent", "status": "complete", "dependencies": ["research_agent"] },
    { "job_name": "distribution_agent", "status": "complete", "dependencies": ["ad_creative_designer", "video_ad_specialist", "copywriter_agent"] }
  ],
  "pipeline_status": "complete",
  "outputs_path": "outputs/deploy_club_campaign_2026-03-31/"
}
```

---

## Rules / Constraints

1. Pipeline deve respeitar dependências entre agentes
2. Research não pode ser pulado sem source folder validada
3. Jobs de imagem e vídeo podem ser pulados a critério do usuário
4. Todos os outputs seguem a convenção: `outputs/<task_name>_<date>/`
5. **Publicação é manual** — só triggered via Distribution Agent com referência ao Publish MD file
6. Nunca publicar conteúdo automaticamente

---

## Features Opcionais de Level-Up

- Agendamento time-based usando BullMQ delayed jobs
- Lógica de retry automático para jobs falhos
- Posting multi-plataforma: Threads, TikTok, LinkedIn

## Camada de Maldade Técnica: Quality Gate
1. **Auto-Crítica:** Antes de considerar um job como `complete`, o Orchestrator deve perguntar ao Copywriter: "Este conteúdo passaria pelo filtro de um diretor de arte agressivo?".
2. **Resiliência de API:** Se o BullMQ reportar falha de rede (status 429 ou 5xx), o Orchestrator deve implementar 3 tentativas automáticas com intervalo de 5 minutos antes de marcar como `failed`.
3. **Validação de Asset:** Se o `Video Ad Specialist` gerar um vídeo, o Orchestrator deve validar se o arquivo `.mp4` tem mais de 1MB. Se for menor, assumir erro de renderização e reiniciar o job de vídeo uma vez.
4. **Flag de Escala:** Adicionar suporte para a flag `"auto_approve": true`. Se presente, o Distribution Agent não aguarda revisão manual e dispara para a API de postagem imediatamente.