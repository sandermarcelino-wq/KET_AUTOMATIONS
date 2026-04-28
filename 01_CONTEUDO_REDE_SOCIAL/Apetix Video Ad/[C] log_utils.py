"""
Log rotation utility for pipeline_log.json.
Rotates the file when it reaches MAX_BYTES, renaming it with a timestamp suffix.
"""

import json
import shutil
from datetime import datetime
from pathlib import Path

MAX_BYTES = 5 * 1024 * 1024  # 5 MB


def _rotated_name(log_path: Path) -> Path:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return log_path.with_name(f"{log_path.stem}_{stamp}{log_path.suffix}")


def rotate_if_needed(log_path: Path) -> bool:
    """Rotate log_path if it exists and is >= 5 MB. Returns True if rotated."""
    log_path = Path(log_path)
    if not log_path.exists() or log_path.stat().st_size < MAX_BYTES:
        return False

    dest = _rotated_name(log_path)
    # Avoid collision if two rotations happen within the same second
    counter = 1
    while dest.exists():
        dest = log_path.with_name(f"{log_path.stem}_{dest.stem[-15:]}_{counter}{log_path.suffix}")
        counter += 1

    shutil.move(str(log_path), str(dest))
    return True


def write_pipeline_log(data: dict, log_path: str | Path = "pipeline_log.json") -> Path:
    """
    Write *data* to log_path as pretty-printed JSON.
    Rotates the existing file first if it has reached 5 MB.
    Returns the path that was written.
    """
    log_path = Path(log_path)
    log_path.parent.mkdir(parents=True, exist_ok=True)

    rotate_if_needed(log_path)

    log_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    return log_path
