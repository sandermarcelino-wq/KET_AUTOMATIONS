"""
bridge_ads_to_content.py — Traduz o briefing de falha de criativo em um
job_payload_REMAKE.json consumível pela composição Remotion de Apetix Video Ad.

Fluxo:
    analyze_ads.py → briefing_for_frente_1.txt
                   → actions_to_take.json
    bridge_ads_to_content.py (este script)
                   → job_payload_REMAKE.json   (lido pelo Remotion / IA de conteúdo)

Uso:
    python bridge_ads_to_content.py
"""

import json
import pathlib
import re
import sys

import anthropic

# ─── caminhos ────────────────────────────────────────────────────────────────

ADS_DIR     = pathlib.Path(__file__).parent
CONTENT_DIR = ADS_DIR.parent / "01_CONTEUDO_REDE_SOCIAL" / "Apetix Video Ad"

BRIEFING_TXT     = ADS_DIR / "reports" / "briefing_for_frente_1.txt"
ACTIONS_JSON     = ADS_DIR / "reports" / "actions_to_take.json"
PERFORMANCE_JSON = ADS_DIR / "reports" / "daily_performance.json"
OUTPUT_JSON      = CONTENT_DIR / "job_payload_REMAKE.json"

# ─── estrutura da composição Remotion ────────────────────────────────────────
# Descreve o que cada cena aceita, para o Claude gerar copy válido.

COMPOSITION_SCHEMA = """
Composição Remotion: "AdVideo"  (Instagram Reels / TikTok, 9:16, 15s, 30fps)

Cenas e campos editáveis:
  scene1_hook     – main_text (até ~6 palavras, impacto máximo)
                  – sub_text  (até ~8 palavras, reforça o hook)
  scene2_problem  – items: lista de EXATAMENTE 3 problemas (cada um até 5 palavras)
  scene3_reframe  – main_text (até 7 palavras, quebra de culpa)
                  – sub_text  (até 8 palavras, reframe do problema)
  scene4_product  – name: sempre "Apetix" (não alterar)
                  – subtitle: até 5 palavras, promessa central do produto
  scene5_benefit  – items: lista de EXATAMENTE 3 benefícios (2-3 palavras cada)
                  – anchor_lines: lista de EXATAMENTE 2 linhas de âncora de preço/prova
  scene6_cta      – main_text: frase de fechamento emocional (até 15 palavras, pode ter \\n)
                  – button_text: texto do botão CTA (até 6 palavras)

Restrições:
  - Todos os textos em português do Brasil
  - Tom: direto, urgência, sem jargão acadêmico
  - Produto: suplemento Apetix (controle de apetite / grelina)
  - NÃO usar emojis nos textos das cenas
"""

# ─── helpers ─────────────────────────────────────────────────────────────────

def load(path: pathlib.Path) -> str:
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


def find_recreate_ads(actions_data: dict, perf_data: dict) -> list[dict]:
    """Retorna os ads com ação RECREATE, enriquecidos com dados de performance."""
    decisions = {d["ad_id"]: d for d in actions_data.get("decisions", [])}
    perf_by_id = {ad["ad_id"]: ad for ad in perf_data.get("ads", [])}

    recreate = []
    for ad_id, decision in decisions.items():
        if decision.get("action") == "RECREATE":
            ad_perf = perf_by_id.get(ad_id, {})
            recreate.append({
                "ad_id": ad_id,
                "campaign_name": ad_perf.get("campaign_name", ad_id),
                "niche": ad_perf.get("niche", ""),
                "ad_format": ad_perf.get("ad_format", ""),
                "original_hook": ad_perf.get("creative_hook", ""),
                "metrics": ad_perf.get("metrics", {}),
                "failure_reason": decision.get("reason", ""),
            })
    return recreate


def generate_scene_copy(briefing: str, recreate_ads: list[dict], report_date: str) -> dict:
    """Chama Claude para gerar copy estruturado por cena para o Remotion."""
    client = anthropic.Anthropic()

    ads_context = json.dumps(recreate_ads, ensure_ascii=False, indent=2)

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        system=[
            {
                "type": "text",
                "text": COMPOSITION_SCHEMA,
                "cache_control": {"type": "ephemeral"},
            },
            {
                "type": "text",
                "text": (
                    "Você é um copywriter especialista em performance marketing para Meta Ads. "
                    "Seu trabalho é gerar copy novo para uma composição de vídeo Remotion que corrija "
                    "a falha de hook identificada pela equipe de tráfego.\n\n"
                    "Retorne SOMENTE JSON válido, sem markdown, sem texto adicional, "
                    "seguindo EXATAMENTE o schema fornecido:\n"
                    "{\n"
                    '  "scenes": {\n'
                    '    "hook":    { "main_text": "", "sub_text": "" },\n'
                    '    "problem": { "items": ["", "", ""] },\n'
                    '    "reframe": { "main_text": "", "sub_text": "" },\n'
                    '    "product": { "name": "Apetix", "subtitle": "" },\n'
                    '    "benefit": { "items": ["", "", ""], "anchor_lines": ["", ""] },\n'
                    '    "cta":     { "main_text": "", "button_text": "" }\n'
                    "  }\n"
                    "}"
                ),
            },
        ],
        messages=[
            {
                "role": "user",
                "content": (
                    f"Data do relatório: {report_date}\n\n"
                    f"=== BRIEFING DA EQUIPE DE TRÁFEGO ===\n{briefing}\n\n"
                    f"=== DADOS DOS ANÚNCIOS COM FALHA ===\n{ads_context}\n\n"
                    "Com base no diagnóstico acima, gere copy novo para TODAS as 6 cenas "
                    "do vídeo Apetix que corrija o ângulo criativo e melhore o CTR."
                ),
            }
        ],
    )

    raw = response.content[0].text.strip()
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


def build_payload(
    recreate_ads: list[dict],
    scene_copy: dict,
    report_date: str,
) -> dict:
    """Monta o job_payload_REMAKE.json completo."""
    primary = recreate_ads[0] if recreate_ads else {}

    return {
        "_meta": {
            "job_type": "REMAKE",
            "generated_at": report_date,
            "source_report_date": report_date,
            "source_ad_ids": [ad["ad_id"] for ad in recreate_ads],
            "failure_summary": {
                ad["ad_id"]: {
                    "original_hook": ad["original_hook"],
                    "ctr_pct": ad["metrics"].get("ctr_pct"),
                    "cpa_brl": ad["metrics"].get("cpa_brl"),
                    "failure_reason": ad["failure_reason"],
                }
                for ad in recreate_ads
            },
        },
        "target_composition": {
            "id": "AdVideo",
            "file": "src/Composition.tsx",
            "platform": "instagram_reels",
            "aspect_ratio": "9:16",
            "duration_seconds": 15,
            "fps": 30,
            "width": 1080,
            "height": 1920,
        },
        "directives": {
            "ctr_target_pct": 1.5,
            "must_fix": "hook — primeiro frame precisa parar o scroll em menos de 2s",
            "keep": ["estética UGC dark", "grain overlay", "paleta preta/vermelha/dourada"],
            "avoid": [
                ad["original_hook"] for ad in recreate_ads if ad.get("original_hook")
            ],
        },
        "scenes": scene_copy.get("scenes", {}),
    }


# ─── main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    print("🌉 Bridge: Ads → Conteúdo")
    print("=" * 45)

    # 1. verificar se o briefing existe
    if not BRIEFING_TXT.exists():
        print(f"ℹ️  Briefing não encontrado em: {BRIEFING_TXT}")
        print("   Nenhum anúncio com ação RECREATE foi detectado.")
        print("   Execute analyze_ads.py primeiro.")
        sys.exit(0)

    print(f"📄 Briefing encontrado: {BRIEFING_TXT.name}")

    # 2. carregar dados
    briefing = BRIEFING_TXT.read_text(encoding="utf-8")

    actions_raw  = load(ACTIONS_JSON)
    perf_raw     = load(PERFORMANCE_JSON)
    actions_data = json.loads(actions_raw) if actions_raw else {}
    perf_data    = json.loads(perf_raw)    if perf_raw    else {}
    report_date  = actions_data.get("report_date", perf_data.get("_meta", {}).get("report_date", "—"))

    recreate_ads = find_recreate_ads(actions_data, perf_data)
    print(f"🔵 Anúncios RECREATE: {len(recreate_ads)}")
    for ad in recreate_ads:
        print(f"   • {ad['ad_id']} — hook original: \"{ad['original_hook']}\"")

    # 3. gerar copy via Claude
    print("\n🤖 Gerando copy para as 6 cenas (Claude API)...")
    scene_copy = generate_scene_copy(briefing, recreate_ads, report_date)

    # 4. montar payload completo
    payload = build_payload(recreate_ads, scene_copy, report_date)

    # 5. gravar output
    CONTENT_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"\n✅ Payload gravado em:")
    print(f"   {OUTPUT_JSON}")
    print()

    # 6. preview das cenas geradas
    scenes = payload.get("scenes", {})
    print("📋 Copy gerado por cena:")
    labels = {
        "hook":    "🎣 Hook",
        "problem": "😣 Problem",
        "reframe": "💡 Reframe",
        "product": "📦 Product",
        "benefit": "✅ Benefit",
        "cta":     "🎯 CTA",
    }
    for key, label in labels.items():
        scene = scenes.get(key, {})
        print(f"\n  {label}:")
        for field, value in scene.items():
            if isinstance(value, list):
                for i, item in enumerate(value, 1):
                    print(f"    [{field} {i}] {item}")
            else:
                print(f"    [{field}] {value}")

    print("\n✅ Bridge concluído. Compartilhe o job_payload_REMAKE.json com a Frente 1.")


if __name__ == "__main__":
    main()
