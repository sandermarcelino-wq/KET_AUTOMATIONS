"""
execute_actions.py — Executa as decisões do ads-manager-agent na API do Meta.

Uso:
    python execute_actions.py           # executa de verdade
    python execute_actions.py --dry-run # simulação: só printa, não toca na API

Credenciais (variáveis de ambiente obrigatórias):
    META_APP_ID
    META_APP_SECRET
    META_ACCESS_TOKEN
    META_AD_ACCOUNT_ID   (formato: act_XXXXXXXXX)
"""

import argparse
import json
import os
import pathlib
import sys

BASE_DIR = pathlib.Path(__file__).parent
ACTIONS_JSON = BASE_DIR / "reports" / "actions_to_take.json"

ACTION_ICONS = {
    "PAUSE": "🔴",
    "SCALE": "🟢",
    "MAINTAIN": "🟡",
    "RECREATE": "🔵",
}

# ─── credenciais ─────────────────────────────────────────────────────────────

def load_credentials() -> dict:
    required = ["META_APP_ID", "META_APP_SECRET", "META_ACCESS_TOKEN", "META_AD_ACCOUNT_ID"]
    creds = {key: os.environ.get(key) for key in required}
    missing = [k for k, v in creds.items() if not v]
    if missing:
        print("❌ Variáveis de ambiente ausentes:")
        for m in missing:
            print(f"   {m}")
        sys.exit(1)
    return creds


# ─── ações reais (facebook-business SDK) ─────────────────────────────────────

def pause_ad(ad_id: str) -> None:
    from facebook_business.adobjects.ad import Ad

    ad = Ad(ad_id)
    ad.api_update(params={"status": Ad.Status.paused})


def scale_adset_budget(ad_id: str, budget_change: float) -> dict:
    """Retorna dict com adset_id, old_budget_brl e new_budget_brl."""
    from facebook_business.adobjects.ad import Ad
    from facebook_business.adobjects.adset import AdSet

    # 1. descobrir qual AdSet pertence a este Ad
    ad_data = Ad(ad_id).api_get(fields=["adset_id"])
    adset_id = ad_data["adset_id"]

    # 2. ler orçamento atual (API retorna centavos como string)
    adset = AdSet(adset_id)
    adset_data = adset.api_get(fields=["name", "daily_budget"])
    current_cents = int(adset_data["daily_budget"])

    # 3. calcular novo orçamento e atualizar
    new_cents = int(current_cents * (1 + budget_change))
    adset.api_update(params={"daily_budget": new_cents})

    return {
        "adset_id": adset_id,
        "adset_name": adset_data.get("name", adset_id),
        "old_budget_brl": current_cents / 100,
        "new_budget_brl": new_cents / 100,
    }


# ─── modo DRY_RUN ────────────────────────────────────────────────────────────

def dry_pause(ad_id: str) -> None:
    print(f"      [DRY-RUN] Ad.api_update(ad_id={ad_id!r}, status='PAUSED')")


def dry_scale(ad_id: str, budget_change: float) -> None:
    pct = int(budget_change * 100)
    print(f"      [DRY-RUN] Buscar AdSet do Ad {ad_id!r}")
    print(f"      [DRY-RUN] AdSet.api_update(daily_budget = atual × {1 + budget_change} (+{pct}%))")


# ─── processamento principal ──────────────────────────────────────────────────

def process_decisions(decisions: list, dry_run: bool) -> None:
    ok = skipped = errors = 0

    for d in decisions:
        ad_id = d["ad_id"]
        action = d["action"]
        reason = d.get("reason", "")
        budget_change = float(d.get("budget_change", 0.0))

        icon = ACTION_ICONS.get(action, "⚪")
        print(f"\n  {icon} [{action}] {ad_id}")
        print(f"     {reason}")

        try:
            if action == "PAUSE":
                if dry_run:
                    dry_pause(ad_id)
                else:
                    pause_ad(ad_id)
                    print(f"      ✅ Ad pausado com sucesso.")
                ok += 1

            elif action == "SCALE":
                if dry_run:
                    dry_scale(ad_id, budget_change)
                else:
                    result = scale_adset_budget(ad_id, budget_change)
                    print(
                        f"      ✅ AdSet '{result['adset_name']}' atualizado: "
                        f"R${result['old_budget_brl']:.2f} → R${result['new_budget_brl']:.2f}"
                    )
                ok += 1

            else:
                # MAINTAIN e RECREATE não geram chamadas à API aqui
                print(f"      ⏭️  Nenhuma ação de API para '{action}' — ignorando.")
                skipped += 1

        except Exception as exc:  # noqa: BLE001
            print(f"      ❌ Erro: {exc}")
            errors += 1

    return ok, skipped, errors


# ─── entrypoint ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Executa ações do ads-manager-agent na API do Meta.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=os.environ.get("DRY_RUN", "").lower() in ("1", "true", "yes"),
        help="Simula as ações sem chamar a API (padrão: False).",
    )
    args = parser.parse_args()

    mode_label = "🧪 SIMULAÇÃO (DRY-RUN)" if args.dry_run else "🚀 EXECUÇÃO REAL"
    print("⚡ Execute Actions — Ads Manager")
    print(f"   Modo: {mode_label}")
    print("=" * 45)

    # ── carregar JSON de ações ────────────────────────────────────────────────
    if not ACTIONS_JSON.exists():
        print(f"❌ Arquivo não encontrado: {ACTIONS_JSON}")
        print("   Execute primeiro: python analyze_ads.py")
        sys.exit(1)

    with ACTIONS_JSON.open(encoding="utf-8") as f:
        data = json.load(f)

    decisions = data.get("decisions", [])
    report_date = data.get("report_date", "—")

    print(f"📅 Relatório: {report_date}")
    print(f"📋 Decisões: {len(decisions)}")

    if not decisions:
        print("ℹ️  Nenhuma decisão para processar.")
        return

    # ── inicializar SDK apenas se não for dry-run ─────────────────────────────
    if not args.dry_run:
        creds = load_credentials()
        try:
            from facebook_business.api import FacebookAdsApi
        except ImportError:
            print("❌ Biblioteca 'facebook-business' não instalada.")
            print("   Execute: pip install facebook-business")
            sys.exit(1)

        FacebookAdsApi.init(
            app_id=creds["META_APP_ID"],
            app_secret=creds["META_APP_SECRET"],
            access_token=creds["META_ACCESS_TOKEN"],
        )
        print(f"🔗 Conectado à API do Meta (conta: {creds['META_AD_ACCOUNT_ID']})")
    else:
        print("ℹ️  SDK do Meta NÃO será inicializado no modo dry-run.")

    # ── executar ──────────────────────────────────────────────────────────────
    print("\n📋 Processando decisões:")
    ok, skipped, errors = process_decisions(decisions, dry_run=args.dry_run)

    # ── resumo ────────────────────────────────────────────────────────────────
    print("\n" + "=" * 45)
    print("📊 Resumo:")
    print(f"   ✅ Executados : {ok}")
    print(f"   ⏭️  Ignorados  : {skipped}")
    print(f"   ❌ Erros      : {errors}")

    if args.dry_run:
        print("\n⚠️  DRY-RUN: nenhuma alteração real foi feita na API do Meta.")

    if errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
