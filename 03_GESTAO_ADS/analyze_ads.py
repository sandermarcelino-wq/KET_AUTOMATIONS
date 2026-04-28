import anthropic
import json
import os
import pathlib
import re
import sys

import requests

BASE_DIR = pathlib.Path(__file__).parent
REPORTS_DIR = BASE_DIR / "reports"
SKILL_PATH = BASE_DIR / ".claude" / "skills" / "ads-manager-agent.md"
PERFORMANCE_JSON = REPORTS_DIR / "daily_performance.json"
ACTIONS_JSON = REPORTS_DIR / "actions_to_take.json"
BRIEFING_TXT = REPORTS_DIR / "briefing_for_frente_1.txt"

client = anthropic.Anthropic()


def load_file(path: pathlib.Path) -> str:
    if not path.exists():
        print(f"❌ Arquivo não encontrado: {path}")
        sys.exit(1)
    return path.read_text(encoding="utf-8")


def analyze_ads(skill_text: str, ads: list) -> dict:
    """Send raw metrics to Claude and get back structured decisions."""
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2048,
        system=[
            {
                "type": "text",
                "text": skill_text,
                "cache_control": {"type": "ephemeral"},  # skill is static — cache it
            },
            {
                "type": "text",
                "text": (
                    "Você é um Gestor de Tráfego de Performance. Analise cada anúncio "
                    "aplicando rigorosamente as três regras da sua Matriz de Decisão:\n"
                    "1. Regra do CPA: compare cpa_brl com cpa_limit_brl do anúncio.\n"
                    "2. Regra do CTR: se ad_format contém 'video' ou 'reels' e ctr_pct < 1.0 → RECREATE.\n"
                    "3. Regra de Escala Segura: budget_change nunca ultrapassa 0.20.\n\n"
                    "Retorne SOMENTE JSON válido, sem markdown, sem texto adicional:\n"
                    '{"decisions": [{"ad_id": "string", "action": "PAUSE|SCALE|MAINTAIN|RECREATE", '
                    '"reason": "string", "budget_change": 0.0, "alert_creative_team": false}]}'
                ),
            },
        ],
        messages=[
            {
                "role": "user",
                "content": (
                    "Analise estes anúncios e retorne as decisões em JSON:\n\n"
                    + json.dumps(ads, ensure_ascii=False, indent=2)
                ),
            }
        ],
    )
    raw = response.content[0].text.strip()

    # Strip markdown code fences if present
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if match:
            return json.loads(match.group())
        print("❌ Resposta da API não é JSON válido:")
        print(raw)
        sys.exit(1)


def generate_briefing(skill_text: str, recreate_ads: list) -> str:
    """Ask Claude to write a creative briefing for failed ads."""
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        system=[
            {
                "type": "text",
                "text": skill_text,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[
            {
                "role": "user",
                "content": (
                    "Os anúncios abaixo foram marcados como RECREATE porque o hook falhou "
                    "(CTR abaixo de 1% em vídeo/reels). Escreva um briefing em português para a "
                    "equipe criativa (Frente 1 — Conteúdo) cobrindo:\n"
                    "1. Qual anúncio falhou e qual a evidência numérica\n"
                    "2. O que o hook atual não conseguiu comunicar\n"
                    "3. Sugestão de novo ângulo criativo\n"
                    "4. Meta de CTR mínima que o novo criativo precisa atingir\n\n"
                    "Dados:\n"
                    + json.dumps(recreate_ads, ensure_ascii=False, indent=2)
                ),
            }
        ],
    )
    return response.content[0].text.strip()


def build_telegram_summary(decisions: list, performance_data: dict, report_date: str) -> str:
    """Monta mensagem de resumo para o Telegram a partir das decisões do agente."""
    # mapa ad_id → campaign_name para deixar a mensagem legível
    name_by_id = {ad["ad_id"]: ad["campaign_name"] for ad in performance_data.get("ads", [])}

    grouped: dict[str, list[str]] = {"PAUSE": [], "SCALE": [], "MAINTAIN": [], "RECREATE": []}
    for d in decisions:
        action = d.get("action", "MAINTAIN")
        label = name_by_id.get(d["ad_id"], d["ad_id"])
        grouped.setdefault(action, []).append(label)

    lines = [f"🚨 *GESTOR DE ADS KET*", f"📅 {report_date}", ""]

    if grouped["PAUSE"]:
        n = len(grouped["PAUSE"])
        noun = "anúncio pausado" if n == 1 else "anúncios pausados"
        lines.append(f"🔴 *{n} {noun} por CPA alto:*")
        lines.extend(f"   • {name}" for name in grouped["PAUSE"])

    if grouped["SCALE"]:
        n = len(grouped["SCALE"])
        noun = "escala aprovada" if n == 1 else "escalas aprovadas"
        lines.append(f"🟢 *{n} {noun} (+20% orçamento):*")
        lines.extend(f"   • {name}" for name in grouped["SCALE"])

    if grouped["RECREATE"]:
        n = len(grouped["RECREATE"])
        noun = "criativo reprovado" if n == 1 else "criativos reprovados"
        lines.append(f"🔵 *{n} {noun} (hook fraco — CTR baixo):*")
        lines.extend(f"   • {name}" for name in grouped["RECREATE"])

    if grouped["MAINTAIN"]:
        n = len(grouped["MAINTAIN"])
        noun = "anúncio mantido" if n == 1 else "anúncios mantidos"
        lines.append(f"🟡 *{n} {noun} — aguardando dados*")

    # rodapé com totais do dia
    summary = performance_data.get("daily_summary", {})
    spend = summary.get("total_spend_brl", 0)
    roas = summary.get("blended_roas", 0)
    if spend:
        lines += ["", f"💰 Gasto total: R${spend:,.2f} | ROAS médio: {roas:.2f}x"]

    return "\n".join(lines)


def send_telegram_message(text: str) -> bool:
    """Envia mensagem via Bot API do Telegram. Retorna True se bem-sucedido."""
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")

    if not token or not chat_id:
        print("⚠️  Telegram não configurado (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID ausentes).")
        return False

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {"chat_id": chat_id, "text": text, "parse_mode": "Markdown"}

    try:
        resp = requests.post(url, json=payload, timeout=10)
        resp.raise_for_status()
        return True
    except requests.RequestException as exc:
        print(f"❌ Falha ao enviar para o Telegram: {exc}")
        return False


def main():
    print("📊 Ads Manager Agent — Análise Diária")
    print("=" * 45)

    skill_text = load_file(SKILL_PATH)
    performance_data = json.loads(load_file(PERFORMANCE_JSON))
    report_date = performance_data["_meta"]["report_date"]

    print(f"📅 Relatório: {report_date}")
    print(f"📁 Anúncios: {len(performance_data['ads'])}")
    print()

    # Strip pre-filled agent_decisions — Claude must reason from raw metrics only
    ads_for_analysis = [
        {
            "ad_id": ad["ad_id"],
            "campaign_name": ad["campaign_name"],
            "niche": ad["niche"],
            "ad_format": ad["ad_format"],
            "creative_hook": ad["creative_hook"],
            "daily_budget_brl": ad["daily_budget_brl"],
            "metrics": ad["metrics"],
            "cpa_limit_brl": ad["cpa_limit_brl"],
        }
        for ad in performance_data["ads"]
    ]

    print("🤖 Enviando para análise (Claude API)...")
    decisions_data = analyze_ads(skill_text, ads_for_analysis)
    decisions_data["report_date"] = report_date

    REPORTS_DIR.mkdir(exist_ok=True)
    ACTIONS_JSON.write_text(
        json.dumps(decisions_data, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"✅ {ACTIONS_JSON.name} salvo.")
    print()

    ACTION_ICONS = {"PAUSE": "🔴", "SCALE": "🟢", "MAINTAIN": "🟡", "RECREATE": "🔵"}
    recreate_ids = []

    print("📋 Decisões:")
    for d in decisions_data["decisions"]:
        icon = ACTION_ICONS.get(d["action"], "⚪")
        change = f"  (+{int(d['budget_change']*100)}%)" if d["budget_change"] > 0 else ""
        print(f"  {icon} [{d['action']}]{change} {d['ad_id']}")
        print(f"     {d['reason']}")
        if d["action"] == "RECREATE":
            recreate_ids.append(d["ad_id"])

    if recreate_ids:
        print()
        print(f"✍️  Gerando briefing para {len(recreate_ids)} anúncio(s) RECREATE...")

        recreate_full = [
            ad for ad in performance_data["ads"] if ad["ad_id"] in recreate_ids
        ]
        briefing_body = generate_briefing(skill_text, recreate_full)

        header = (
            f"BRIEFING PARA FRENTE 1 — CONTEÚDO\n"
            f"Data: {report_date}\n"
            f"Anúncios com falha de hook: {', '.join(recreate_ids)}\n"
            + "=" * 50
            + "\n\n"
        )
        BRIEFING_TXT.write_text(header + briefing_body, encoding="utf-8")
        print(f"✅ {BRIEFING_TXT.name} salvo.")

    # ── notificação Telegram ──────────────────────────────────────────────────
    print("📲 Enviando resumo para o Telegram...")
    summary_text = build_telegram_summary(
        decisions_data.get("decisions", []), performance_data, report_date
    )
    if send_telegram_message(summary_text):
        print("✅ Mensagem enviada.")
    print()
    print("✅ Análise concluída.")


if __name__ == "__main__":
    main()
