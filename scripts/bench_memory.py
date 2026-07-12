#!/usr/bin/env python3
"""Benchmark interactive CLI memory + startup latency using process-tree PSS.

Adapted from jcode's scripts/bench_memory_cli.py for the freecode project.

Measures, per tool, at N sessions:
  - PSS (MB) summed across all descendant processes + process group
  - Time to first visible content (first meaningful line in PTY output)
  - Time to first input echo (probe string echoed back)
  - Process count
  - Version string

Usage:
    python3 scripts/bench_memory.py --sessions 1
    python3 scripts/bench_memory.py --sessions 10 --json-out results-10.json
    python3 scripts/bench_memory.py --tools freecode claude_code codex
"""

from __future__ import annotations

import argparse
import json
import os
import pty
import re
import select
import shutil
import signal
import socket
import subprocess
import tempfile
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

FREECODE_PACKAGE_JSON_REL = "apps/tui/package.json"
FREECODE_WORKSPACE_MARKER = "pnpm-workspace.yaml"

ANSI_RE = re.compile(r"\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x1b\x07]*(?:\x07|\x1b\\))")
PROBE = "fcqx92"
DEFAULT_TIMEOUT_S = 20.0
DEFAULT_SETTLE_S = 1.0
DEFAULT_TOOLS = [
    "freecode",
    "pi",
    "codex",
    "opencode",
    "copilot_cli",
    "cursor_agent",
    "claude_code",
    "antigravity_cli",
]


@dataclass
class ToolSpec:
    name: str
    argv: list[str]
    version_argv: list[str]
    env: dict[str, str] | None = None


@dataclass
class SessionLaunch:
    root_pid: int
    pgid: int
    master_fd: int
    ready: bool
    input_ready: bool
    excerpt: str | None
    seconds_to_visible: float | None
    seconds_to_input_ready: float | None
    buffer_excerpt: str | None


@dataclass
class ToolRunResult:
    tool: str
    sessions: int
    pss_mb: float
    process_count: int
    version: str
    seconds_to_visible_med: float | None
    seconds_to_input_ready_med: float | None
    notes: list[str] = field(default_factory=list)


def shutil_which(name: str) -> str | None:
    return subprocess.run(
        ["bash", "-lc", f"command -v {name}"], capture_output=True, text=True, check=False
    ).stdout.strip() or None


def detect_pi_bin() -> str:
    direct = shutil_which("pi")
    if direct:
        return direct
    prefix = subprocess.check_output(["npm", "prefix", "-g"], text=True).strip()
    candidate = Path(prefix) / "bin" / "pi"
    if candidate.exists():
        return str(candidate)
    raise FileNotFoundError("could not find pi binary")


def is_freecode_root(p: Path) -> bool:
    return (
        (p / FREECODE_WORKSPACE_MARKER).exists()
        and (p / FREECODE_PACKAGE_JSON_REL).exists()
    )


def find_freecode_root() -> Path | None:
    """Locate the freecode monorepo root.

    Checks (in order):
    1. The directory containing this script's parent (assumes scripts/bench_memory.py)
    2. cwd and each ancestor
    """
    script_parent = Path(__file__).resolve().parent.parent
    if is_freecode_root(script_parent):
        return script_parent
    p = Path.cwd().resolve()
    for parent in [p, *p.parents]:
        if is_freecode_root(parent):
            return parent
    return None


def build_freecode_spec() -> ToolSpec:
    """Resolve a runnable freecode invocation.

    Order of preference:
    1. `freecode` on PATH
    2. Built binary at <monorepo>/apps/tui/dist/index.js  (no tsx overhead)
    3. `pnpm --filter @thisisayande/freecode dev` from the monorepo root
    4. ~/.local/bin/freecode  (last-resort fallback)
    """
    on_path = shutil_which("freecode")
    if on_path:
        return ToolSpec(
            name="freecode",
            argv=[on_path],
            version_argv=[on_path, "--version"],
        )

    root = find_freecode_root()
    if root:
        built = root / "apps/tui" / "dist" / "index.js"
        pkg_json = root / FREECODE_PACKAGE_JSON_REL
        version_argv = [
            "node",
            "-p",
            f"require({json.dumps(str(pkg_json))}).version",
        ]
        if built.exists():
            return ToolSpec(
                name="freecode",
                argv=["node", str(built)],
                version_argv=version_argv,
            )
        return ToolSpec(
            name="freecode",
            argv=["pnpm", "--filter", "@thisisayande/freecode", "dev"],
            version_argv=version_argv,
        )

    fallback = str(Path.home() / ".local/bin/freecode")
    return ToolSpec(
        name="freecode",
        argv=[fallback],
        version_argv=[fallback, "--version"],
    )


def build_specs() -> dict[str, ToolSpec]:
    freecode_spec = build_freecode_spec()
    codex = shutil_which("codex") or "/usr/bin/codex"
    opencode = shutil_which("opencode") or "/usr/bin/opencode"
    copilot = shutil_which("copilot") or str(Path.home() / ".local/bin/copilot")
    cursor_agent = shutil_which("cursor-agent") or str(Path.home() / ".local/bin/cursor-agent")
    claude = shutil_which("claude") or str(Path.home() / ".local/bin/claude")
    agy = shutil_which("agy") or str(Path.home() / ".local/bin/agy")
    specs = {
        "freecode": freecode_spec,
        "pi": ToolSpec(
            name="pi",
            argv=[detect_pi_bin()],
            version_argv=[detect_pi_bin(), "--version"],
        ),
        "codex": ToolSpec(
            name="codex",
            argv=[codex],
            version_argv=[codex, "--version"],
        ),
        "opencode": ToolSpec(
            name="opencode",
            argv=[opencode],
            version_argv=[opencode, "--version"],
        ),
        "copilot_cli": ToolSpec(
            name="copilot_cli",
            argv=[copilot],
            version_argv=[copilot, "--version"],
        ),
        "cursor_agent": ToolSpec(
            name="cursor_agent",
            argv=[cursor_agent],
            version_argv=[cursor_agent, "--version"],
        ),
        "claude_code": ToolSpec(
            name="claude_code",
            argv=[claude],
            version_argv=[claude, "--version"],
        ),
        "antigravity_cli": ToolSpec(
            name="antigravity_cli",
            argv=[agy],
            version_argv=[agy, "--version"],
        ),
    }
    return specs


def reply_queries(master_fd: int, buffer: bytes) -> bytes:
    replies = [
        (b"\x1b[6n", b"\x1b[1;1R"),
        (b"\x1b[c", b"\x1b[?62;c"),
        (b"\x1b]10;?\x1b\\", b"\x1b]10;rgb:ffff/ffff/ffff\x1b\\"),
        (b"\x1b]11;?\x1b\\", b"\x1b]11;rgb:0000/0000/0000\x1b\\"),
        (b"\x1b]10;?\x07", b"\x1b]10;rgb:ffff/ffff/ffff\x07"),
        (b"\x1b]11;?\x07", b"\x1b]11;rgb:0000/0000/0000\x07"),
        (b"\x1b]4;0;?\x07", b"\x1b]4;0;rgb:0000/0000/0000\x07"),
        (b"\x1b[14t", b"\x1b[4;600;800t"),
        (b"\x1b[16t", b"\x1b[6;16;8t"),
        (b"\x1b[18t", b"\x1b[8;24;80t"),
        (b"\x1b[?1016$p", b"\x1b[?1016;1$y"),
        (b"\x1b[?2027$p", b"\x1b[?2027;1$y"),
        (b"\x1b[?2031$p", b"\x1b[?2031;1$y"),
        (b"\x1b[?1004$p", b"\x1b[?1004;1$y"),
        (b"\x1b[?2004$p", b"\x1b[?2004;1$y"),
        (b"\x1b[?2026$p", b"\x1b[?2026;1$y"),
    ]
    changed = True
    while changed:
        changed = False
        for query, response in replies:
            if query in buffer:
                os.write(master_fd, response)
                buffer = buffer.replace(query, b"")
                changed = True
    return buffer


def strip_ansi(text: str) -> str:
    return ANSI_RE.sub("", text).replace("\r", "\n")


def first_meaningful_line(text: str) -> str | None:
    for raw_line in text.splitlines():
        line = " ".join(raw_line.split())
        if not line:
            continue
        alnum_count = sum(ch.isalnum() for ch in line)
        if alnum_count >= 3 and len(line) >= 4:
            return line[:160]
    return None


def launch_interactive(
    argv: list[str],
    cwd: Path,
    env: dict[str, str],
    timeout_s: float,
    settle_s: float,
) -> SessionLaunch:
    master_fd, slave_fd = pty.openpty()
    proc = subprocess.Popen(
        argv,
        cwd=str(cwd),
        env=env,
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        preexec_fn=os.setsid,
    )
    os.close(slave_fd)
    os.set_blocking(master_fd, False)
    start = time.perf_counter()
    buf = b""
    ready = False
    input_ready = False
    probe_sent = False
    excerpt = None
    t_visible: float | None = None
    t_input_ready: float | None = None
    while time.perf_counter() - start < timeout_s:
        rlist, _, _ = select.select([master_fd], [], [], 0.05)
        if rlist:
            try:
                chunk = os.read(master_fd, 65536)
            except BlockingIOError:
                chunk = b""
            if chunk:
                buf += chunk
                buf = reply_queries(master_fd, buf)
                plain = strip_ansi(buf.decode("utf-8", "replace"))
                excerpt = first_meaningful_line(plain)
                if excerpt:
                    if not ready:
                        t_visible = time.perf_counter() - start
                    ready = True
                    if not probe_sent:
                        try:
                            os.write(master_fd, PROBE.encode())
                            probe_sent = True
                        except OSError:
                            break
                if probe_sent and PROBE in plain:
                    if not input_ready:
                        t_input_ready = time.perf_counter() - start
                    input_ready = True
                    break
        if proc.poll() is not None:
            break
    if input_ready or ready:
        time.sleep(settle_s)
    return SessionLaunch(
        root_pid=proc.pid,
        pgid=os.getpgid(proc.pid),
        master_fd=master_fd,
        ready=ready,
        input_ready=input_ready,
        excerpt=excerpt,
        seconds_to_visible=t_visible,
        seconds_to_input_ready=t_input_ready,
        buffer_excerpt=(strip_ansi(buf.decode("utf-8", "replace"))[:300] or None),
    )


def iter_proc_stat() -> dict[int, tuple[int, int]]:
    out: dict[int, tuple[int, int]] = {}
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            stat = (entry / "stat").read_text()
        except Exception:
            continue
        try:
            close = stat.rfind(")")
            rest = stat[close + 2 :].split()
            ppid = int(rest[1])
            pgid = int(rest[2])
            out[int(entry.name)] = (ppid, pgid)
        except Exception:
            continue
    return out


def collect_descendants(root_pids: list[int]) -> set[int]:
    ppid_of = iter_proc_stat()
    children: dict[int, list[int]] = {}
    for pid, (ppid, _pgid) in ppid_of.items():
        children.setdefault(ppid, []).append(pid)
    seen: set[int] = set()
    stack = list(root_pids)
    while stack:
        pid = stack.pop()
        if pid in seen:
            continue
        seen.add(pid)
        stack.extend(children.get(pid, []))
    return seen


def collect_process_group_pids(pgids: list[int]) -> set[int]:
    proc_map = iter_proc_stat()
    wanted = set(pgids)
    return {pid for pid, (_ppid, pgid) in proc_map.items() if pgid in wanted}


def read_pss_mb(pid: int) -> float | None:
    path = Path(f"/proc/{pid}/smaps_rollup")
    try:
        for line in path.read_text().splitlines():
            if line.startswith("Pss:"):
                return int(line.split()[1]) / 1024.0
    except Exception:
        return None
    return None


def sum_tree_pss(root_pids: list[int], pgids: list[int]) -> tuple[float, int]:
    all_pids = collect_descendants(root_pids) | collect_process_group_pids(pgids)
    total = 0.0
    counted = 0
    for pid in sorted(all_pids):
        pss = read_pss_mb(pid)
        if pss is None:
            continue
        total += pss
        counted += 1
    return round(total, 1), counted


def terminate_pgroup(pgid: int) -> None:
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(pgid, sig)
            time.sleep(0.2)
        except ProcessLookupError:
            return


def version_for(spec: ToolSpec) -> str:
    proc = subprocess.run(spec.version_argv, capture_output=True, text=True, check=False)
    output = (proc.stdout + proc.stderr).strip().splitlines()
    return output[0] if output else f"exit {proc.returncode}"


def median_or_none(values: list[float]) -> float | None:
    if not values:
        return None
    s = sorted(values)
    n = len(s)
    mid = n // 2
    if n % 2 == 1:
        return s[mid]
    return (s[mid - 1] + s[mid]) / 2


def run_tool(
    spec: ToolSpec,
    sessions: int,
    cwd: Path,
    timeout_s: float,
    settle_s: float,
) -> ToolRunResult:
    notes: list[str] = []
    version = version_for(spec)
    launches: list[SessionLaunch] = []
    cleanup_pgids: list[int] = []
    try:
        env = os.environ.copy()
        if spec.env:
            env.update(spec.env)
        for _ in range(sessions):
            launches.append(
                launch_interactive(spec.argv, cwd, env, timeout_s, settle_s)
            )
            cleanup_pgids.append(launches[-1].pgid)
        root_pids = [launch.root_pid for launch in launches]
        sample_pgids = cleanup_pgids.copy()

        for idx, launch in enumerate(launches, start=1):
            if not launch.ready:
                notes.append(f"session {idx}: no meaningful screen content before timeout")
            elif launch.excerpt:
                notes.append(f"session {idx}: {launch.excerpt}")
        pss_mb, process_count = sum_tree_pss(root_pids, sample_pgids)

        visible = [
            l.seconds_to_visible
            for l in launches
            if l.seconds_to_visible is not None
        ]
        input_ready = [
            l.seconds_to_input_ready
            for l in launches
            if l.seconds_to_input_ready is not None
        ]

        return ToolRunResult(
            tool=spec.name,
            sessions=sessions,
            pss_mb=pss_mb,
            process_count=process_count,
            version=version,
            seconds_to_visible_med=median_or_none(visible),
            seconds_to_input_ready_med=median_or_none(input_ready),
            notes=notes,
        )
    finally:
        for launch in launches:
            try:
                os.close(launch.master_fd)
            except Exception:
                pass
        for pgid in reversed(cleanup_pgids):
            terminate_pgroup(pgid)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sessions", type=int, required=True)
    parser.add_argument("--tools", nargs="*", default=DEFAULT_TOOLS)
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT_S)
    parser.add_argument("--settle", type=float, default=DEFAULT_SETTLE_S)
    parser.add_argument("--cwd", default=os.getcwd())
    parser.add_argument("--json-out", default=None)
    args = parser.parse_args()

    specs = build_specs()
    cwd = Path(args.cwd).resolve()
    results = []
    for name in args.tools:
        if name not in specs:
            print(f"=== {name}: unknown tool, skipping ===", flush=True)
            continue
        spec = specs[name]
        print(
            f"=== {name} ({args.sessions} session{'s' if args.sessions != 1 else ''}) ===",
            flush=True,
        )
        try:
            result = run_tool(spec, args.sessions, cwd, args.timeout, args.settle)
        except Exception as e:
            print(f"  error: {e}", flush=True)
            continue
        print(json.dumps(asdict(result), indent=2), flush=True)
        results.append(asdict(result))
    payload = {"cwd": str(cwd), "sessions": args.sessions, "results": results}
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(payload, indent=2))
    else:
        print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())