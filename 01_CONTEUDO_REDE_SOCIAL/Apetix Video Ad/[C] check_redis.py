"""
Redis health-check + auto-start for BullMQ.
Reads REDIS_HOST / REDIS_PORT from .env (falls back to localhost:6379).
Tries three startup strategies on Windows: native service, WSL, Docker.
"""

import os
import socket
import subprocess
import sys
import time
from pathlib import Path

# ── .env parser (no deps required) ────────────────────────────────────────────

def load_env(env_path: Path) -> dict:
    env = {}
    if not env_path.exists():
        return env
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        env[key.strip()] = value.strip().strip('"').strip("'")
    return env


# ── Redis connectivity check ───────────────────────────────────────────────────

def redis_is_up(host: str, port: int, timeout: float = 2.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout) as sock:
            # Send a minimal Redis PING and expect +PONG
            sock.sendall(b"*1\r\n$4\r\nPING\r\n")
            response = sock.recv(128)
            return response.startswith(b"+PONG")
    except (ConnectionRefusedError, OSError, TimeoutError):
        return False


# ── Startup strategies (Windows) ───────────────────────────────────────────────

def _run(cmd: list[str], timeout: int = 10) -> bool:
    """Run a command silently. Returns True if exit code == 0."""
    try:
        result = subprocess.run(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=timeout,
        )
        return result.returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return False


def try_windows_service(service_name: str = "Redis") -> bool:
    print(f"  → Trying Windows service '{service_name}'...")
    return _run(["net", "start", service_name])


def try_wsl_redis() -> bool:
    print("  → Trying Redis via WSL...")
    return _run(["wsl", "sudo", "service", "redis-server", "start"])


def try_docker_redis(image: str = "redis:7-alpine", host_port: int = 6379) -> bool:
    print("  → Trying Docker (redis:7-alpine)...")
    # Check if a redis container is already stopped
    existing = subprocess.run(
        ["docker", "ps", "-a", "--filter", "name=redis-bullmq", "--format", "{{.Status}}"],
        capture_output=True, text=True
    )
    if existing.returncode == 0 and existing.stdout.strip():
        # Container exists — just start it
        return _run(["docker", "start", "redis-bullmq"])
    # Create and run a new container
    return _run([
        "docker", "run", "-d",
        "--name", "redis-bullmq",
        "--restart", "unless-stopped",
        "-p", f"{host_port}:6379",
        image,
    ])


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> int:
    env_file = Path(__file__).parent / ".env"
    env = load_env(env_file)

    host = env.get("REDIS_HOST", "127.0.0.1")
    port = int(env.get("REDIS_PORT", 6379))

    print(f"[check_redis] Target: {host}:{port}")

    if redis_is_up(host, port):
        print("[check_redis] Redis already UP. BullMQ is safe.")
        return 0

    print("[check_redis] Redis is DOWN. Attempting to start...")

    strategies = [try_windows_service, try_wsl_redis, try_docker_redis]
    for attempt in strategies:
        if attempt():
            # Give the process a moment to bind
            time.sleep(2)
            if redis_is_up(host, port):
                print("[check_redis] Redis started successfully. BullMQ is safe.")
                return 0
            print("  ✗ Process started but Redis still unreachable.")
        else:
            print("  ✗ Strategy failed or unavailable.")

    print(
        "[check_redis] ERROR: Could not start Redis.\n"
        "  Manual options:\n"
        "    • Install Redis for Windows: https://github.com/tporadowski/redis/releases\n"
        "    • Run via WSL: wsl sudo service redis-server start\n"
        "    • Run via Docker: docker run -d -p 6379:6379 redis:7-alpine\n"
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
