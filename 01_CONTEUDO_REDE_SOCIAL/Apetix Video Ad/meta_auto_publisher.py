"""
meta_auto_publisher.py — Agendamento automático no Instagram via Meta Graph API.

Lê o weekly_schedule.json de um batch semanal, localiza os assets gerados e
agenda cada post no Instagram com scheduled_publish_time.

Flow por dia:
  1. Lê date + hour do weekly_schedule.json  →  unix timestamp
  2. Detecta asset: ads/instagram_ad.png (IMAGE) ou video/*.mp4 (REELS)
  3. Constrói URL pública: BASE_URL_ASSETS / {batch} / {day} / {arquivo}
  4. Cria media container via API com published=false + scheduled_publish_time
  5. Para vídeos: aguarda status_code=FINISHED antes de confirmar agendamento
  6. Salva publish_report.json com container_id e status de cada dia

Uso:
    python meta_auto_publisher.py --batch outputs/campanha_semanal_2026-05-05/
    python meta_auto_publisher.py --batch outputs/campanha_semanal_2026-05-05/ --dry-run
    python meta_auto_publisher.py --batch outputs/campanha_semanal_2026-05-05/ --day 0

Credenciais obrigatórias no .env:
    META_ACCESS_TOKEN   — token de usuário com permissão instagram_content_publish
    INSTAGRAM_USER_ID   — ID numérico da conta Business/Creator do Instagram
    BASE_URL_ASSETS     — URL pública base onde os arquivos estão hospedados
"""

import argparse
import json
import os
import sys
import time
import datetime
from pathlib import Path

import requests
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Configuração
# ---------------------------------------------------------------------------

load_dotenv()

PROJECT_ROOT = Path(__file__).parent.resolve()

GRAPH_API_BASE = "https://graph.facebook.com/v21.0"

# Limites da Meta API para agendamento
MIN_SCHEDULE_MINUTES = 10      # mínimo: 10 minutos no futuro
MAX_SCHEDULE_DAYS = 75         # máximo: 75 dias no futuro

# Polling de vídeos
VIDEO_POLL_INTERVAL_S = 10
VIDEO_POLL_MAX_ATTEMPTS = 36   # 6 minutos no total

# ---------------------------------------------------------------------------
# Credenciais
# ---------------------------------------------------------------------------

def load_credentials() -> dict:
    required = {
        "META_ACCESS_TOKEN": "Token de usuário (instagram_content_publish)",
        "INSTAGRAM_USER_ID": "ID numérico da conta Instagram Business/Creator",
        "BASE_URL_ASSETS": "URL pública base dos assets (ex: https://vps.ket.com.br/assets)",
    }
    creds = {k: os.getenv(k, "").strip() for k in required}
    missing = [f"{k} — {desc}" for k, desc in required.items() if not creds[k]]
    if missing:
        print("Credenciais ausentes no .env:")
        for m in missing:
            print(f"  {m}")
        sys.exit(1)
    return creds


# ---------------------------------------------------------------------------
# Graph API helpers
# ---------------------------------------------------------------------------

def _api_post(path: str, token: str, params: dict, dry_run: bool) -> dict:
    """POST para a Graph API. Em dry-run, apenas imprime e retorna stub."""
    url = f"{GRAPH_API_BASE}/{path}"
    if dry_run:
        print(f"  [DRY-RUN] POST {url}")
        for k, v in params.items():
            print(f"    {k}: {v}")
        return {"id": "DRY_RUN_CONTAINER_ID"}

    resp = requests.post(url, params={"access_token": token, **params}, timeout=30)
    data = resp.json()
    if "error" in data:
        raise RuntimeError(f"Graph API erro: {data['error'].get('message', data['error'])}")
    return data


def _api_get(path: str, token: str, fields: str) -> dict:
    url = f"{GRAPH_API_BASE}/{path}"
    resp = requests.get(url, params={"access_token": token, "fields": fields}, timeout=30)
    data = resp.json()
    if "error" in data:
        raise RuntimeError(f"Graph API erro: {data['error'].get('message', data['error'])}")
    return data


# ---------------------------------------------------------------------------
# Asset detection
# ---------------------------------------------------------------------------

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
VIDEO_EXTENSIONS = {".mp4", ".mov"}

# Caminhos a checar, em ordem de preferência
IMAGE_CANDIDATES = [
    "ads/instagram_ad.png",
    "ads/instagram_ad.jpg",
    "ads/instagram_ad.jpeg",
]


def find_assets(day_dir: Path) -> dict:
    """
    Retorna dict com:
      image_path, video_path, caption
    A prioridade de caption é: copy/instagram_caption.txt > job_payload notes.
    """
    assets = {"image_path": None, "video_path": None, "caption": ""}

    # Imagem — candidatos fixos primeiro, depois glob
    for rel in IMAGE_CANDIDATES:
        candidate = day_dir / rel
        if candidate.exists():
            assets["image_path"] = candidate
            break
    if not assets["image_path"]:
        for f in (day_dir / "ads").glob("*") if (day_dir / "ads").exists() else []:
            if f.suffix.lower() in IMAGE_EXTENSIONS:
                assets["image_path"] = f
                break

    # Vídeo
    video_dir = day_dir / "video"
    if video_dir.exists():
        for f in video_dir.glob("*"):
            if f.suffix.lower() in VIDEO_EXTENSIONS:
                assets["video_path"] = f
                break

    # Caption — prefere arquivo gerado pelo copywriter
    caption_file = day_dir / "copy" / "instagram_caption.txt"
    if caption_file.exists():
        assets["caption"] = caption_file.read_text(encoding="utf-8").strip()
    else:
        payload_file = day_dir / "job_payload.json"
        if payload_file.exists():
            payload = json.loads(payload_file.read_text(encoding="utf-8"))
            assets["caption"] = payload.get("caption_hook", "")

    return assets


# ---------------------------------------------------------------------------
# URL builder
# ---------------------------------------------------------------------------

def asset_to_url(local_path: Path, batch_dir: Path, base_url: str) -> str:
    """
    Converte caminho local em URL pública.
    Estrutura esperada: outputs/{batch_name}/{day_folder}/{arquivo}
    URL gerada:        {BASE_URL_ASSETS}/{batch_name}/{day_folder}/{arquivo}
    """
    base_url = base_url.rstrip("/")
    try:
        # Caminho relativo a partir de outputs/
        outputs_dir = PROJECT_ROOT / "outputs"
        rel = local_path.relative_to(outputs_dir)
    except ValueError:
        # Fallback: relativo ao PROJECT_ROOT
        rel = local_path.relative_to(PROJECT_ROOT)

    return f"{base_url}/{rel.as_posix()}"


# ---------------------------------------------------------------------------
# Instagram scheduling
# ---------------------------------------------------------------------------

def _parse_publish_ts(date_str: str, hour_str: str) -> int:
    """Converte 'YYYY-MM-DD' + 'HH:MM' em Unix timestamp UTC."""
    naive = datetime.datetime.strptime(f"{date_str} {hour_str}", "%Y-%m-%d %H:%M")
    # Assume horário local — ajuste para UTC se necessário
    return int(naive.timestamp())


def _validate_schedule_time(ts: int) -> str | None:
    """Retorna mensagem de erro ou None se o timestamp for válido."""
    now = int(time.time())
    min_ts = now + MIN_SCHEDULE_MINUTES * 60
    max_ts = now + MAX_SCHEDULE_DAYS * 24 * 3600
    if ts < min_ts:
        return f"Horário no passado ou muito próximo (mínimo {MIN_SCHEDULE_MINUTES} min no futuro)"
    if ts > max_ts:
        return f"Horário muito distante (máximo {MAX_SCHEDULE_DAYS} dias)"
    return None


def schedule_image_post(
    ig_user_id: str,
    token: str,
    image_url: str,
    caption: str,
    publish_ts: int,
    dry_run: bool,
) -> str:
    """Cria container de imagem agendado. Retorna container_id."""
    result = _api_post(
        f"{ig_user_id}/media",
        token,
        {
            "image_url": image_url,
            "caption": caption,
            "media_type": "IMAGE",
            "published": "false",
            "scheduled_publish_time": publish_ts,
        },
        dry_run,
    )
    return result["id"]


def schedule_video_post(
    ig_user_id: str,
    token: str,
    video_url: str,
    caption: str,
    publish_ts: int,
    dry_run: bool,
) -> str:
    """
    Cria container de Reels agendado.
    Aguarda status_code=FINISHED antes de retornar o container_id.
    """
    result = _api_post(
        f"{ig_user_id}/media",
        token,
        {
            "video_url": video_url,
            "caption": caption,
            "media_type": "REELS",
            "published": "false",
            "scheduled_publish_time": publish_ts,
        },
        dry_run,
    )
    container_id = result["id"]

    if dry_run:
        return container_id

    # Poll até o vídeo ser processado pela Meta
    print(f"  Aguardando processamento do vídeo (container {container_id})...")
    for attempt in range(1, VIDEO_POLL_MAX_ATTEMPTS + 1):
        time.sleep(VIDEO_POLL_INTERVAL_S)
        status_data = _api_get(container_id, token, "status_code")
        status = status_data.get("status_code", "")
        print(f"  [{attempt}/{VIDEO_POLL_MAX_ATTEMPTS}] status_code: {status}")
        if status == "FINISHED":
            return container_id
        if status == "ERROR":
            raise RuntimeError(f"Meta rejeitou o vídeo (status_code=ERROR) — verifique o formato.")

    raise TimeoutError(
        f"Vídeo não processou após {VIDEO_POLL_MAX_ATTEMPTS * VIDEO_POLL_INTERVAL_S}s"
    )


# ---------------------------------------------------------------------------
# Por-dia
# ---------------------------------------------------------------------------

def publish_day(
    day_index: int,
    day_entry: dict,
    batch_dir: Path,
    creds: dict,
    dry_run: bool,
) -> dict:
    date_str = day_entry.get("date", "?")
    hour_str = day_entry.get("hour", "18:00")
    angle = day_entry.get("angle", "")

    label = f"Dia {day_index + 1} ({date_str} {hour_str}) — {angle}"
    print(f"\n{'─' * 55}")
    print(f"  {label}")

    result = {
        "day_index": day_index + 1,
        "date": date_str,
        "hour": hour_str,
        "angle": angle,
        "status": "skipped",
        "container_id": None,
        "media_type": None,
        "asset_url": None,
        "error": None,
    }

    # Localizar pasta do dia dentro do batch
    day_folders = sorted(batch_dir.glob(f"day_{day_index + 1:02d}_*"))
    if not day_folders:
        # Fallback: qualquer pasta day_N
        day_folders = sorted(batch_dir.glob(f"day_{day_index + 1}_*"))
    if not day_folders:
        result["error"] = f"Pasta day_{day_index + 1:02d}_* não encontrada em {batch_dir}"
        result["status"] = "failed"
        print(f"  FALHOU: {result['error']}")
        return result

    day_dir = day_folders[0]
    print(f"  Pasta: {day_dir.name}")

    # Assets
    assets = find_assets(day_dir)
    if not assets["image_path"] and not assets["video_path"]:
        result["error"] = "Nenhum asset (imagem ou vídeo) encontrado nesta pasta"
        result["status"] = "failed"
        print(f"  FALHOU: {result['error']}")
        return result

    # Timestamp de publicação
    publish_ts = _parse_publish_ts(date_str, hour_str)
    ts_error = _validate_schedule_time(publish_ts)
    if ts_error and not dry_run:
        result["error"] = f"Horário inválido: {ts_error}"
        result["status"] = "failed"
        print(f"  FALHOU: {result['error']}")
        return result

    caption = assets["caption"] or angle
    token = creds["META_ACCESS_TOKEN"]
    ig_user_id = creds["INSTAGRAM_USER_ID"]
    base_url = creds["BASE_URL_ASSETS"]

    try:
        if assets["video_path"]:
            video_url = asset_to_url(assets["video_path"], batch_dir, base_url)
            print(f"  Tipo: REELS | URL: {video_url}")
            container_id = schedule_video_post(
                ig_user_id, token, video_url, caption, publish_ts, dry_run
            )
            result["media_type"] = "REELS"
            result["asset_url"] = video_url
        else:
            image_url = asset_to_url(assets["image_path"], batch_dir, base_url)
            print(f"  Tipo: IMAGE | URL: {image_url}")
            container_id = schedule_image_post(
                ig_user_id, token, image_url, caption, publish_ts, dry_run
            )
            result["media_type"] = "IMAGE"
            result["asset_url"] = image_url

        result["container_id"] = container_id
        result["status"] = "scheduled"
        scheduled_dt = datetime.datetime.fromtimestamp(publish_ts).strftime("%Y-%m-%d %H:%M")
        print(f"  Agendado para: {scheduled_dt} (container: {container_id})")

    except Exception as exc:
        result["error"] = str(exc)
        result["status"] = "failed"
        print(f"  FALHOU: {exc}")

    return result


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def run_publisher(batch_dir: Path, dry_run: bool, only_day: int | None) -> None:
    creds = load_credentials()

    schedule_path = batch_dir / "weekly_schedule.json"
    if not schedule_path.exists():
        print(f"weekly_schedule.json não encontrado em: {batch_dir}")
        sys.exit(1)

    schedule = json.loads(schedule_path.read_text(encoding="utf-8"))
    days = schedule.get("days", [])
    if not days:
        print("weekly_schedule.json não contém dias.")
        sys.exit(1)

    print("=" * 55)
    print("META AUTO PUBLISHER")
    print(f"Batch  : {batch_dir.name}")
    print(f"Dias   : {len(days)}")
    print(f"Modo   : {'DRY-RUN (nenhuma chamada real à API)' if dry_run else 'REAL'}")
    print(f"IG ID  : {creds['INSTAGRAM_USER_ID']}")
    print("=" * 55)

    if only_day is not None:
        days_to_process = [(only_day, days[only_day])]
    else:
        days_to_process = list(enumerate(days))

    report = {
        "batch": batch_dir.name,
        "generated_at": datetime.date.today().isoformat(),
        "dry_run": dry_run,
        "days": [],
    }

    scheduled = failed = skipped = 0

    for idx, day_entry in days_to_process:
        day_result = publish_day(idx, day_entry, batch_dir, creds, dry_run)
        report["days"].append(day_result)

        if day_result["status"] == "scheduled":
            scheduled += 1
        elif day_result["status"] == "failed":
            failed += 1
        else:
            skipped += 1

    # Salvar relatório
    report_path = batch_dir / "publish_report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\n{'=' * 55}")
    print(f"CONCLUÍDO: {scheduled} agendados | {failed} falhas | {skipped} ignorados")
    print(f"Relatório: {report_path}")
    if dry_run:
        print("DRY-RUN: nenhuma publicação real foi feita.")
    print("=" * 55)

    if failed:
        sys.exit(1)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Agenda posts do batch semanal no Instagram."
    )
    parser.add_argument(
        "--batch", required=True, metavar="PASTA",
        help="Caminho para a pasta do batch (ex: outputs/campanha_semanal_2026-05-05/)",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Simula sem chamar a API do Meta",
    )
    parser.add_argument(
        "--day", type=int, default=None, metavar="N",
        help="Processa apenas o dia N (0=segunda … 6=domingo)",
    )
    args = parser.parse_args()

    batch_dir = Path(args.batch).resolve()
    if not batch_dir.exists():
        print(f"Pasta do batch não encontrada: {batch_dir}")
        sys.exit(1)

    if args.day is not None and not (0 <= args.day <= 6):
        print("--day deve ser um número entre 0 e 6")
        sys.exit(1)

    run_publisher(batch_dir, dry_run=args.dry_run, only_day=args.day)


if __name__ == "__main__":
    main()
