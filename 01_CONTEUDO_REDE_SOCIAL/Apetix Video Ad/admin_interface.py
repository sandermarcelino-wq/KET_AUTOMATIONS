"""
KET Admin Bot — Interface Telegram para disparar pipelines de marketing.

Instalação:
    pip install python-telegram-bot python-dotenv

Configuração (.env):
    TELEGRAM_BOT_TOKEN=seu_token_aqui
    TELEGRAM_ADMIN_CHAT_ID=seu_chat_id_aqui  (recomendado — restringe acesso)

Comandos disponíveis:
    /comando  — cria campanha e dispara o Orchestrator (Frente 1)
    /ads      — roda analyze_ads.py e devolve o relatório de decisões (Frente 3)
    /status   — mostra o último job criado
    /ajuda    — lista todos os comandos

Para rodar em segundo plano:
    Windows: start_bot.bat (na raiz do projeto)
    Linux/Mac: nohup python admin_interface.py &
"""

import json
import logging
import os
import asyncio
from datetime import date
from pathlib import Path

from dotenv import load_dotenv
from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes

# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------

load_dotenv()

TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
ADMIN_CHAT_ID = os.getenv("TELEGRAM_ADMIN_CHAT_ID")
BASE_URL_ASSETS = os.getenv("BASE_URL_ASSETS", "").rstrip("/")

PROJECT_ROOT = Path(__file__).parent.resolve()
ADS_DIR = (PROJECT_ROOT / ".." / ".." / "03_GESTAO_ADS").resolve()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(PROJECT_ROOT / "bot.log", encoding="utf-8"),
        logging.StreamHandler(),
    ],
)
log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Auth guard
# ---------------------------------------------------------------------------

def _is_admin(update: Update) -> bool:
    if not ADMIN_CHAT_ID:
        return True
    return str(update.effective_chat.id) == ADMIN_CHAT_ID


# ---------------------------------------------------------------------------
# /comando — Frente 1 (Apetix Video Ad pipeline)
# ---------------------------------------------------------------------------

FIELD_ALIASES = {
    "produto": "product", "product": "product",
    "nicho": "niche", "niche": "niche",
    "público": "audience", "publico": "audience",
    "audience": "audience", "audiencia": "audience", "audiência": "audience",
    "plataformas": "platform_targets", "platforms": "platform_targets",
    "notas": "notes", "notes": "notes",
    "nome": "task_name", "task_name": "task_name",
}

BOOLEAN_FLAGS = {"skip_research", "skip_image", "skip_video", "auto_approve", "dry_run"}


def _slugify(text: str) -> str:
    return (
        text.lower()
        .replace(" ", "_").replace("/", "_").replace("\\", "_")
        .replace(":", "").replace("|", "").strip("_")
    )


def _parse_comando(text: str) -> dict:
    raw = text.strip()
    for prefix in ("/comando", "/COMANDO"):
        if raw.startswith(prefix):
            raw = raw[len(prefix):].strip()
            break

    payload: dict = {
        "task_date": date.today().isoformat(),
        "user_flags": {k: False for k in BOOLEAN_FLAGS},
        "platform_targets": ["instagram", "youtube"],
        "notes": "",
    }

    for part in [p.strip() for p in raw.split("|")]:
        if not part:
            continue
        normalized = part.lower()
        if normalized in BOOLEAN_FLAGS:
            payload["user_flags"][normalized] = True
            continue
        if ":" in part:
            key, _, value = part.partition(":")
            field = FIELD_ALIASES.get(key.strip().lower())
            value = value.strip()
            if field == "platform_targets":
                payload["platform_targets"] = [
                    p.strip() for p in value.replace(",", " ").split() if p.strip()
                ]
            elif field:
                payload[field] = value

    if "task_name" not in payload:
        payload["task_name"] = f"{_slugify(payload.get('product', 'campanha'))}_{payload['task_date']}"
    payload["output_folder"] = f"outputs/{payload['task_name']}/"
    return payload


def _validate_payload(payload: dict) -> list[str]:
    return [f for f in ("product", "niche", "audience") if not payload.get(f)]


def _format_flags(flags: dict) -> str:
    active = [k for k, v in flags.items() if v]
    return ", ".join(active) if active else "nenhuma"


async def cmd_comando(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _is_admin(update):
        await update.message.reply_text("Acesso negado.")
        return

    try:
        payload = _parse_comando(update.message.text or "")
    except Exception as exc:
        await update.message.reply_text(f"Erro ao interpretar comando:\n{exc}")
        return

    missing = _validate_payload(payload)
    if missing:
        await update.message.reply_text(
            f"Campos obrigatórios ausentes: {', '.join(missing)}\n\n"
            "Formato:\n"
            "/comando produto: X | nicho: Y | público: Z | plataformas: instagram youtube | notas: ..."
        )
        return

    output_dir = PROJECT_ROOT / payload["output_folder"]
    output_dir.mkdir(parents=True, exist_ok=True)
    payload_path = output_dir / "job_payload.json"

    for path in (payload_path, PROJECT_ROOT / "job_payload.json"):
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    await update.message.reply_text(
        f"Job criado: {payload['task_name']}\n"
        f"Produto: {payload['product']}\n"
        f"Nicho: {payload['niche']}\n"
        f"Público: {payload['audience']}\n"
        f"Plataformas: {', '.join(payload['platform_targets'])}\n"
        f"Flags: {_format_flags(payload['user_flags'])}\n\n"
        f"Disparando Orchestrator..."
    )
    asyncio.create_task(_run_orchestrator(update, payload, str(payload_path)))


async def _run_orchestrator(update: Update, payload: dict, payload_path: str) -> None:
    prompt = (
        f"Execute o pipeline completo de criação de conteúdo. "
        f"O job payload está em: {payload_path} "
        f"Use o skill /orchestrator para coordenar todos os agentes."
    )
    try:
        proc = await asyncio.create_subprocess_exec(
            "claude", prompt,
            cwd=str(PROJECT_ROOT),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await update.message.reply_text(f"Orchestrator iniciado (PID {proc.pid}). Aguarde...")
        stdout, stderr = await proc.communicate()

        if proc.returncode == 0:
            task_name = payload["task_name"]
            msg = f"✅ Campanha Pronta!\nNome: {task_name}\n"
            if BASE_URL_ASSETS:
                ad_url = f"{BASE_URL_ASSETS}/{task_name}/ads/instagram_ad.png"
                msg += f"Veja o anúncio aqui:\n{ad_url}"
            else:
                msg += f"Output: {payload['output_folder']}"
            await update.message.reply_text(msg)
        else:
            err = (stderr.decode("utf-8", errors="replace")[:600]) if stderr else "sem detalhes"
            await update.message.reply_text(
                f"Pipeline falhou (código {proc.returncode}).\n\n{err}"
            )
    except FileNotFoundError:
        await update.message.reply_text(
            f"Claude CLI não encontrado no PATH.\nJob payload salvo em:\n{payload_path}"
        )
    except Exception as exc:
        log.exception("Erro no orchestrator")
        await update.message.reply_text(f"Erro inesperado no Orchestrator:\n{exc}")


# ---------------------------------------------------------------------------
# /ads — Frente 3 (Gestão de Ads)
# ---------------------------------------------------------------------------

ACTION_EMOJI = {
    "PAUSE": "🔴",
    "SCALE": "🟢",
    "RECREATE": "🔵",
    "MAINTAIN": "🟡",
}

ACTION_LABEL = {
    "PAUSE": "PAUSAR",
    "SCALE": "ESCALAR",
    "RECREATE": "RECRIAR",
    "MAINTAIN": "MANTER",
}


def _build_ad_name_map(ads_dir: Path) -> dict[str, str]:
    """Return {ad_id: campaign_name} from daily_performance.json."""
    perf_file = ads_dir / "reports" / "daily_performance.json"
    if not perf_file.exists():
        return {}
    try:
        data = json.loads(perf_file.read_text(encoding="utf-8"))
        return {ad["ad_id"]: ad.get("campaign_name", ad["ad_id"]) for ad in data.get("ads", [])}
    except Exception:
        return {}


def _build_summary_stats(ads_dir: Path) -> dict:
    """Return daily_summary fields from daily_performance.json."""
    perf_file = ads_dir / "reports" / "daily_performance.json"
    if not perf_file.exists():
        return {}
    try:
        data = json.loads(perf_file.read_text(encoding="utf-8"))
        return data.get("daily_summary", {})
    except Exception:
        return {}


def _format_ads_report(decisions_data: dict, name_map: dict, summary: dict) -> str:
    decisions = decisions_data.get("decisions", [])
    report_date = decisions_data.get("report_date", date.today().isoformat())

    # Group by action
    groups: dict[str, list[dict]] = {k: [] for k in ACTION_EMOJI}
    for d in decisions:
        action = d.get("action", "MAINTAIN")
        groups.setdefault(action, []).append(d)

    lines = [f"🚨 RELATÓRIO DE ADS — {report_date}\n"]

    for action in ("PAUSE", "SCALE", "RECREATE", "MAINTAIN"):
        items = groups.get(action, [])
        if not items:
            continue
        emoji = ACTION_EMOJI[action]
        label = ACTION_LABEL[action]
        lines.append(f"{emoji} {label} ({len(items)}):")
        for d in items:
            ad_id = d.get("ad_id", "?")
            name = name_map.get(ad_id, ad_id)
            reason = d.get("reason", "")
            short_reason = reason.split(".")[0].strip() if reason else ""
            budget = d.get("budget_change", 0)
            budget_str = f" (+{int(budget * 100)}%)" if budget > 0 else ""
            lines.append(f"   • {name}{budget_str}")
            if short_reason:
                lines.append(f"     {short_reason}")
        lines.append("")

    # Footer with daily stats
    if summary:
        spend = summary.get("total_spend_brl", 0)
        roas = summary.get("blended_roas", 0)
        conversions = summary.get("total_conversions", 0)
        lines.append(
            f"💰 Gasto: R${spend:,.2f} | ROAS: {roas:.2f}x | Conversões: {conversions}"
        )

    return "\n".join(lines)


async def cmd_ads(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _is_admin(update):
        await update.message.reply_text("Acesso negado.")
        return

    if not ADS_DIR.exists():
        await update.message.reply_text(
            f"Pasta 03_GESTAO_ADS não encontrada em:\n{ADS_DIR}"
        )
        return

    analyze_script = ADS_DIR / "analyze_ads.py"
    if not analyze_script.exists():
        await update.message.reply_text(
            f"Script analyze_ads.py não encontrado em:\n{ADS_DIR}"
        )
        return

    await update.message.reply_text("Analisando performance dos ads... Aguarde.")

    asyncio.create_task(_run_analyze_ads(update))


async def _run_analyze_ads(update: Update) -> None:
    analyze_script = ADS_DIR / "analyze_ads.py"
    actions_file = ADS_DIR / "reports" / "actions_to_take.json"
    briefing_file = ADS_DIR / "reports" / "briefing_for_frente_1.txt"

    try:
        proc = await asyncio.create_subprocess_exec(
            "python", str(analyze_script),
            cwd=str(ADS_DIR),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        log.info("analyze_ads.py iniciado (PID %s)", proc.pid)
        stdout, stderr = await proc.communicate()

        if proc.returncode != 0:
            err = (stderr.decode("utf-8", errors="replace")[:800]) if stderr else "sem detalhes"
            await update.message.reply_text(
                f"analyze_ads.py falhou (código {proc.returncode}).\n\n{err}"
            )
            return

        # Read and format the decisions report
        if not actions_file.exists():
            await update.message.reply_text(
                "analyze_ads.py concluiu mas actions_to_take.json não foi gerado."
            )
            return

        decisions_data = json.loads(actions_file.read_text(encoding="utf-8"))
        name_map = _build_ad_name_map(ADS_DIR)
        summary = _build_summary_stats(ADS_DIR)

        report = _format_ads_report(decisions_data, name_map, summary)

        # Telegram messages max 4096 chars — split if needed
        for chunk in _split_message(report, limit=4000):
            await update.message.reply_text(chunk)

        # Send briefing if RECREATE actions exist
        if briefing_file.exists():
            briefing = briefing_file.read_text(encoding="utf-8").strip()
            if briefing:
                header = "📋 Briefing gerado para a Frente 1:\n\n"
                for chunk in _split_message(header + briefing, limit=4000):
                    await update.message.reply_text(chunk)

        log.info("Relatório de ads enviado com sucesso")

    except Exception as exc:
        log.exception("Erro em _run_analyze_ads")
        await update.message.reply_text(f"Erro ao analisar ads:\n{exc}")


def _split_message(text: str, limit: int = 4000) -> list[str]:
    """Split text into chunks under `limit` characters, breaking at newlines."""
    if len(text) <= limit:
        return [text]
    chunks = []
    while text:
        if len(text) <= limit:
            chunks.append(text)
            break
        split_at = text.rfind("\n", 0, limit)
        if split_at == -1:
            split_at = limit
        chunks.append(text[:split_at])
        text = text[split_at:].lstrip("\n")
    return chunks


# ---------------------------------------------------------------------------
# /status
# ---------------------------------------------------------------------------

async def cmd_status(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _is_admin(update):
        await update.message.reply_text("Acesso negado.")
        return

    root_payload = PROJECT_ROOT / "job_payload.json"
    if not root_payload.exists():
        await update.message.reply_text("Nenhum job ativo encontrado.")
        return

    payload = json.loads(root_payload.read_text(encoding="utf-8"))
    await update.message.reply_text(
        f"Último job (Frente 1):\n"
        f"Nome: {payload.get('task_name', '?')}\n"
        f"Data: {payload.get('task_date', '?')}\n"
        f"Produto: {payload.get('product', '?')}\n"
        f"Nicho: {payload.get('niche', '?')}\n"
        f"Output: {payload.get('output_folder', '?')}"
    )


# ---------------------------------------------------------------------------
# /ajuda
# ---------------------------------------------------------------------------

async def cmd_ajuda(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text(
        "*KET Admin Bot*\n\n"
        "*Frente 1 — Conteúdo:*\n"
        "`/comando produto: X | nicho: Y | público: Z`\n"
        "Cria campanha e dispara o Orchestrator.\n\n"
        "_Campos opcionais:_\n"
        "• `plataformas:` instagram youtube\n"
        "• `notas:` instruções extras\n"
        "• `nome:` task_name manual\n\n"
        "_Flags (sem dois-pontos):_\n"
        "`skip_research` `skip_image` `skip_video` `auto_approve` `dry_run`\n\n"
        "─────────────────────\n"
        "*Frente 3 — Gestão de Ads:*\n"
        "`/ads`\n"
        "Roda analyze_ads.py e devolve o relatório de decisões (pausar, escalar, recriar).\n\n"
        "─────────────────────\n"
        "*Utilitários:*\n"
        "`/status` — último job da Frente 1\n"
        "`/ajuda`  — esta mensagem",
        parse_mode="Markdown",
    )


# ---------------------------------------------------------------------------
# Global error handler (keeps bot alive on unexpected exceptions)
# ---------------------------------------------------------------------------

async def _error_handler(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    log.exception("Exceção não tratada no handler", exc_info=context.error)
    if isinstance(update, Update) and update.message:
        try:
            await update.message.reply_text(
                f"Ocorreu um erro interno:\n{context.error}\nVerifique bot.log para detalhes."
            )
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    if not TOKEN:
        raise SystemExit(
            "TELEGRAM_BOT_TOKEN não encontrado.\n"
            "Adicione ao .env: TELEGRAM_BOT_TOKEN=seu_token_aqui\n"
            "Crie um bot em @BotFather no Telegram."
        )

    app = Application.builder().token(TOKEN).build()
    app.add_handler(CommandHandler("comando", cmd_comando))
    app.add_handler(CommandHandler("ads", cmd_ads))
    app.add_handler(CommandHandler("status", cmd_status))
    app.add_handler(CommandHandler("ajuda", cmd_ajuda))
    app.add_handler(CommandHandler("start", cmd_ajuda))
    app.add_error_handler(_error_handler)

    log.info("KET Admin Bot iniciado. Projeto: %s", PROJECT_ROOT)
    log.info("Frente 3 (ads): %s", ADS_DIR)
    if ADMIN_CHAT_ID:
        log.info("Acesso restrito ao chat ID: %s", ADMIN_CHAT_ID)
    else:
        log.warning("TELEGRAM_ADMIN_CHAT_ID não definido — qualquer usuário pode enviar comandos.")

    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
