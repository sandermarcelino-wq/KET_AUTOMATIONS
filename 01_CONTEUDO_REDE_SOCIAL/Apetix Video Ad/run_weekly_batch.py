"""
run_weekly_batch.py — Batch semanal automático de conteúdo.

Fases:
  1. Chama o strategy-planner-agent para gerar weekly_schedule.json (7 dias)
  2. Para cada dia: cria job_payload.json e dispara o Orchestrator
  3. Tudo organizado em outputs/campanha_semanal_{data}/

Uso:
  python run_weekly_batch.py --produto "Apetix" --nicho "controle de apetite" --publico "mulheres 25-45"

Flags opcionais:
  --plataformas instagram youtube   (padrão: instagram youtube)
  --dry-run                         (skipa imagem, vídeo e research — só testa o fluxo)
  --skip-planner                    (usa weekly_schedule.json já existente na pasta do batch)
"""

import argparse
import json
import logging
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

# ---------------------------------------------------------------------------
# Configuração
# ---------------------------------------------------------------------------

PROJECT_ROOT = Path(__file__).parent.resolve()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger(__name__)

DIAS_SEMANA = {
    0: "segunda",
    1: "terca",
    2: "quarta",
    3: "quinta",
    4: "sexta",
    5: "sabado",
    6: "domingo",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _slugify(text: str) -> str:
    return (
        text.lower()
        .replace(" ", "_").replace("/", "_").replace("\\", "_")
        .replace("ã", "a").replace("â", "a").replace("á", "a").replace("à", "a")
        .replace("é", "e").replace("ê", "e").replace("è", "e")
        .replace("í", "i").replace("î", "i")
        .replace("ó", "o").replace("ô", "o").replace("õ", "o")
        .replace("ú", "u").replace("û", "u")
        .replace("ç", "c")
        .replace(":", "").replace("|", "").replace(",", "").strip("_")
    )


def _run_claude(prompt: str, cwd: Path, label: str) -> tuple[int, str, str]:
    """Roda `claude <prompt>` e retorna (returncode, stdout, stderr)."""
    log.info("[%s] Chamando Claude CLI...", label)
    result = subprocess.run(
        ["claude", prompt],
        cwd=str(cwd),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return result.returncode, result.stdout, result.stderr


def _save_report(batch_dir: Path, report: dict) -> None:
    path = batch_dir / "batch_report.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


# ---------------------------------------------------------------------------
# Fase 1 — Strategy Planner
# ---------------------------------------------------------------------------

def run_strategy_planner(
    batch_dir: Path,
    produto: str,
    nicho: str,
    publico: str,
    start_date: date,
) -> Path:
    """Chama o skill strategy-planner-agent e retorna o caminho do weekly_schedule.json."""
    schedule_path = batch_dir / "weekly_schedule.json"

    prompt = (
        f"Execute o skill /strategy-planner-agent com os seguintes parâmetros:\n"
        f"- Produto: {produto}\n"
        f"- Nicho: {nicho}\n"
        f"- Público-alvo: {publico}\n"
        f"- A semana começa em: {start_date.isoformat()} (segunda-feira)\n"
        f"Salve o resultado como weekly_schedule.json no caminho exato: {schedule_path}\n"
        f"O JSON deve seguir o formato do skill: "
        f'{{ "niche": "...", "days": [{{ "date": "YYYY-MM-DD", "hour": "HH:MM", '
        f'"angle": "...", "visual_prompt": "...", "caption_hook": "..." }}] }}'
    )

    code, stdout, stderr = _run_claude(prompt, PROJECT_ROOT, "strategy-planner")

    if code != 0:
        log.error("Strategy planner falhou (código %d):\n%s", code, stderr[:600])
        raise RuntimeError(f"strategy-planner-agent falhou com código {code}")

    if not schedule_path.exists():
        raise FileNotFoundError(
            f"Claude concluiu mas weekly_schedule.json não foi criado em:\n{schedule_path}"
        )

    log.info("weekly_schedule.json gerado: %s", schedule_path)
    return schedule_path


# ---------------------------------------------------------------------------
# Fase 2 — Montar job_payload por dia
# ---------------------------------------------------------------------------

def build_day_payload(
    day_entry: dict,
    day_index: int,
    produto: str,
    nicho: str,
    publico: str,
    plataformas: list[str],
    batch_dir: Path,
    dry_run: bool,
) -> tuple[Path, dict]:
    """Cria a pasta e o job_payload.json para um dia. Retorna (payload_path, payload)."""
    day_date = day_entry["date"]
    weekday_num = date.fromisoformat(day_date).weekday()
    weekday_name = DIAS_SEMANA.get(weekday_num, f"dia{weekday_num}")
    angle_slug = _slugify(day_entry.get("angle", f"angulo_{day_index + 1}"))[:40]

    task_name = f"sem_{_slugify(day_date)}_{weekday_name}_{angle_slug}"
    day_dir = batch_dir / f"day_{day_index + 1:02d}_{weekday_name}"
    day_dir.mkdir(parents=True, exist_ok=True)

    payload = {
        "task_name": task_name,
        "task_date": day_date,
        "product": produto,
        "niche": nicho,
        "audience": publico,
        "campaign_angle": day_entry.get("angle", ""),
        "visual_prompt": day_entry.get("visual_prompt", ""),
        "caption_hook": day_entry.get("caption_hook", ""),
        "posting_hour": day_entry.get("hour", "18:00"),
        "user_flags": {
            "skip_research": dry_run,
            "skip_image": dry_run,
            "skip_video": dry_run,
            "auto_approve": False,
            "dry_run": dry_run,
        },
        "platform_targets": plataformas,
        "output_folder": str(day_dir.relative_to(PROJECT_ROOT)).replace("\\", "/") + "/",
        "notes": (
            f"Dia {day_index + 1}/7 do batch semanal. "
            f"Ângulo: {day_entry.get('angle', '')}. "
            f"Hook: {day_entry.get('caption_hook', '')}."
        ),
    }

    payload_path = day_dir / "job_payload.json"
    payload_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    # Também escreve na raiz do projeto para o Orchestrator achar facilmente
    (PROJECT_ROOT / "job_payload.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    return payload_path, payload


# ---------------------------------------------------------------------------
# Fase 3 — Disparar Orchestrator por dia
# ---------------------------------------------------------------------------

def run_orchestrator_for_day(payload_path: Path, payload: dict, label: str) -> dict:
    """Dispara o Orchestrator para um dia e retorna o status."""
    prompt = (
        f"Execute o pipeline completo de criação de conteúdo. "
        f"O job payload está em: {payload_path} "
        f"Use o skill /orchestrator para coordenar todos os agentes: "
        f"research, ad_creative_designer, video_ad_specialist, copywriter e distribution. "
        f"Ângulo do dia: {payload.get('campaign_angle', '')}. "
        f"Visual prompt: {payload.get('visual_prompt', '')}."
    )

    code, stdout, stderr = _run_claude(prompt, PROJECT_ROOT, label)

    status = {
        "task_name": payload["task_name"],
        "date": payload["task_date"],
        "angle": payload.get("campaign_angle", ""),
        "output_folder": payload["output_folder"],
        "returncode": code,
        "status": "complete" if code == 0 else "failed",
        "error": stderr[:400] if code != 0 else None,
    }

    if code == 0:
        log.info("[%s] Pipeline concluído. Output: %s", label, payload["output_folder"])
    else:
        log.error("[%s] Pipeline falhou (código %d):\n%s", label, code, stderr[:400])

    return status


# ---------------------------------------------------------------------------
# Orquestração principal
# ---------------------------------------------------------------------------

def run_batch(
    produto: str,
    nicho: str,
    publico: str,
    plataformas: list[str],
    dry_run: bool,
    skip_planner: bool,
) -> None:
    today = date.today()
    # Próxima segunda-feira (ou hoje se já for segunda)
    days_until_monday = (7 - today.weekday()) % 7 or 7
    next_monday = today + timedelta(days=days_until_monday)

    batch_name = f"campanha_semanal_{next_monday.isoformat()}"
    batch_dir = PROJECT_ROOT / "outputs" / batch_name
    batch_dir.mkdir(parents=True, exist_ok=True)

    log.info("=" * 60)
    log.info("BATCH SEMANAL — %s", batch_name)
    log.info("Produto: %s | Nicho: %s", produto, nicho)
    log.info("Dry-run: %s | Plataformas: %s", dry_run, plataformas)
    log.info("Output: %s", batch_dir)
    log.info("=" * 60)

    report = {
        "batch_name": batch_name,
        "product": produto,
        "niche": nicho,
        "audience": publico,
        "platform_targets": plataformas,
        "dry_run": dry_run,
        "start_date": next_monday.isoformat(),
        "generated_at": today.isoformat(),
        "days": [],
        "batch_status": "running",
    }
    _save_report(batch_dir, report)

    # ── Fase 1: Strategy Planner ─────────────────────────────────────────
    schedule_path = batch_dir / "weekly_schedule.json"

    if skip_planner and schedule_path.exists():
        log.info("--skip-planner: usando weekly_schedule.json existente.")
    else:
        log.info("Fase 1/3 — Gerando plano editorial com strategy-planner-agent...")
        try:
            run_strategy_planner(batch_dir, produto, nicho, publico, next_monday)
        except Exception as exc:
            log.error("Fase 1 falhou: %s", exc)
            report["batch_status"] = "failed"
            report["error"] = str(exc)
            _save_report(batch_dir, report)
            sys.exit(1)

    schedule = json.loads(schedule_path.read_text(encoding="utf-8"))
    days = schedule.get("days", [])

    if not days:
        log.error("weekly_schedule.json não contém dias. Abortando.")
        sys.exit(1)

    log.info("Plano gerado: %d dias agendados.", len(days))

    # ── Fases 2 + 3: Payload + Orchestrator por dia ──────────────────────
    log.info("Fase 2+3 — Criando payloads e disparando Orchestrator para cada dia...")

    for i, day_entry in enumerate(days):
        day_label = f"Dia {i + 1}/{len(days)} ({day_entry.get('date', '?')})"
        log.info("-" * 50)
        log.info("%s | Ângulo: %s", day_label, day_entry.get("angle", "?"))

        try:
            payload_path, payload = build_day_payload(
                day_entry, i, produto, nicho, publico,
                plataformas, batch_dir, dry_run,
            )
        except Exception as exc:
            log.error("[%s] Erro ao criar payload: %s", day_label, exc)
            report["days"].append({
                "date": day_entry.get("date"),
                "status": "failed",
                "error": str(exc),
            })
            _save_report(batch_dir, report)
            continue

        day_status = run_orchestrator_for_day(payload_path, payload, day_label)
        report["days"].append(day_status)
        _save_report(batch_dir, report)  # salva progresso após cada dia

    # ── Sumário final ─────────────────────────────────────────────────────
    total = len(report["days"])
    completed = sum(1 for d in report["days"] if d.get("status") == "complete")
    failed = total - completed

    report["batch_status"] = "complete" if failed == 0 else "partial" if completed > 0 else "failed"
    report["summary"] = {"total": total, "completed": completed, "failed": failed}
    _save_report(batch_dir, report)

    log.info("=" * 60)
    log.info("BATCH CONCLUÍDO: %d/%d dias com sucesso.", completed, total)
    if failed:
        log.warning("%d dias falharam. Verifique batch_report.json.", failed)
    log.info("Relatório: %s", batch_dir / "batch_report.json")
    log.info("=" * 60)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Batch semanal — gera 7 dias de conteúdo com IA."
    )
    parser.add_argument("--produto", required=True, help="Nome do produto")
    parser.add_argument("--nicho", required=True, help="Nicho / mercado")
    parser.add_argument("--publico", required=True, help="Público-alvo")
    parser.add_argument(
        "--plataformas", nargs="+", default=["instagram", "youtube"],
        metavar="PLAT", help="Plataformas-alvo (padrão: instagram youtube)"
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Testa o fluxo sem gerar imagem/vídeo/research"
    )
    parser.add_argument(
        "--skip-planner", action="store_true",
        help="Pula o strategy-planner e usa weekly_schedule.json já existente"
    )

    args = parser.parse_args()

    run_batch(
        produto=args.produto,
        nicho=args.nicho,
        publico=args.publico,
        plataformas=args.plataformas,
        dry_run=args.dry_run,
        skip_planner=args.skip_planner,
    )


if __name__ == "__main__":
    main()
