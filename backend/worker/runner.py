"""Cancellable bounded subprocess runner. No shell, no pipe deadlocks."""
from __future__ import annotations
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time
from typing import Callable


class StitchError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class LeaseLost(RuntimeError):
    pass


def run_command(args: list[str], *, cwd: Path, checkpoint: Callable[[], None], timeout: float = 120,
                input_text: str = '') -> str:
    checkpoint()
    with tempfile.TemporaryFile() as log, tempfile.TemporaryFile() as stdin:
        stdin.write(input_text.encode())
        stdin.seek(0)
        try:
            platform_options = ({'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt'
                                else {'start_new_session': True})
            process = subprocess.Popen(args, cwd=cwd, stdin=stdin, stdout=log, stderr=subprocess.STDOUT,
                                       **platform_options, env={**os.environ, 'OMP_NUM_THREADS': os.getenv('STITCH_THREADS', '2')})
        except OSError as exc:
            raise StitchError('TOOL_FAILED', f'Cannot start {args[0]}') from exc
        started = time.monotonic()
        try:
            while process.poll() is None:
                checkpoint()
                if time.monotonic() - started >= timeout:
                    raise StitchError('TIMEOUT', f'{args[0]} exceeded its time limit')
                time.sleep(0.25)
            checkpoint()
            if process.returncode:
                log.seek(0, 2)
                length = log.tell()
                log.seek(max(0, length - 2000))
                import logging
                logging.getLogger(__name__).warning('%s failed: %s', args[0], log.read().decode(errors='replace'))
                raise StitchError('TOOL_FAILED', f'{args[0]} could not process the capture')
            log.seek(0)
            return log.read(4 * 1024 * 1024).decode(errors='replace')
        finally:
            if process.poll() is None:
                if os.name == 'nt':
                    # Hugin can launch children; terminate the entire job tree.
                    subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                   creationflags=subprocess.CREATE_NO_WINDOW, timeout=10)
                    process.wait(timeout=10)
                else:
                    _stop_posix(process)


def _stop_posix(process):
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()
