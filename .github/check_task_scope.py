"""Advisory task ownership report; related integration edits are allowed."""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import subprocess
import sys
from copy import deepcopy


ROOT = Path(__file__).resolve().parents[1]
TASK_ID_PATTERN = re.compile(r"\b(ttk-[a-z0-9-]+)\b", re.IGNORECASE)


def changed_files(base_sha: str, head_sha: str) -> list[str]:
    result = subprocess.run(
        ["git", "diff", "--name-only", f"{base_sha}...{head_sha}"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return [line for line in result.stdout.splitlines() if line]


def owns(pattern: str, path: str) -> bool:
    if pattern.endswith("/**"):
        return path.startswith(pattern[:-2])
    return pattern == path


def git_file(revision: str, path: str) -> str:
    result = subprocess.run(
        ["git", "show", f"{revision}:{path}"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout


def is_task_status_only_change(task_id: str, path: str, base_sha: str, head_sha: str) -> bool:
    before = git_file(base_sha, path)
    after = git_file(head_sha, path)

    if path == "TASKS/manifest.json":
        old_manifest = json.loads(before)
        new_manifest = json.loads(after)
        old_task = next((item for item in old_manifest["tasks"] if item["id"] == task_id), None)
        new_task = next((item for item in new_manifest["tasks"] if item["id"] == task_id), None)
        if old_task is None or new_task is None or new_task.get("state") != "complete":
            return False
        old_normalized, new_normalized = deepcopy(old_manifest), deepcopy(new_manifest)
        for manifest in (old_normalized, new_normalized):
            item = next(entry for entry in manifest["tasks"] if entry["id"] == task_id)
            item["state"] = "__task_status__"
        return old_normalized == new_normalized

    if path == "TASKS/WORKPLAN.md":
        task_line = re.compile(rf"^(- \[)[ x](\] `{re.escape(task_id)}`.*)$", re.MULTILINE)
        old_matches = task_line.findall(before)
        new_matches = task_line.findall(after)
        if len(old_matches) != 1 or len(new_matches) != 1:
            return False
        normalized_before, old_count = task_line.subn(r"\1_\2", before)
        normalized_after, new_count = task_line.subn(r"\1_\2", after)
        return old_count == new_count == 1 and normalized_before == normalized_after

    return False


def main() -> int:
    title = os.environ.get("PR_TITLE", "")
    base_sha = os.environ.get("BASE_SHA")
    head_sha = os.environ.get("HEAD_SHA")
    if not base_sha or not head_sha:
        print("BASE_SHA and HEAD_SHA are required", file=sys.stderr)
        return 2

    match = TASK_ID_PATTERN.search(title)
    if not match:
        print("No task ID: review the related module owners")
        return 0
    task_id = match.group(1).lower()

    manifest = json.loads((ROOT / "TASKS/manifest.json").read_text(encoding="utf-8"))
    task = next((item for item in manifest["tasks"] if item["id"] == task_id), None)
    if task is None:
        print(f"Unregistered task: {task_id}; inspect changed module owners")
        return 0

    files = changed_files(base_sha, head_sha)
    violations = []
    for path in files:
        if any(owns(pattern, path) for pattern in task["allowed_paths"]):
            continue
        if path in {"TASKS/manifest.json", "TASKS/WORKPLAN.md"} and is_task_status_only_change(
            task_id, path, base_sha, head_sha
        ):
            continue
        violations.append(path)
    if violations:
        print(f"Task {task_id} is not allowed to change:", file=sys.stderr)
        for path in violations:
            print(f"  {path}", file=sys.stderr)
        print("Review shared changes with the affected module owners.", file=sys.stderr)
        return 0

    print(f"Task scope OK: {task_id} ({len(files)} changed files)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
