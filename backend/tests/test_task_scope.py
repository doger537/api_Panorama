"""Historical status-only changes must not crash the advisory scope checker."""
from pathlib import Path
import runpy


def test_legacy_workplan_status_change_and_content_change(monkeypatch):
    checker = runpy.run_path(str(Path(__file__).parents[2] / '.github/check_task_scope.py'))
    check = checker['is_task_status_only_change']
    versions = {'old': '- [ ] `ttk-test` a task', 'new': '- [x] `ttk-test` a task'}
    monkeypatch.setitem(check.__globals__, 'git_file', lambda revision, _: versions[revision])
    assert check('ttk-test', 'TASKS/WORKPLAN.md', 'old', 'new')
    versions['new'] = '- [x] `ttk-test` a different task'
    assert not check('ttk-test', 'TASKS/WORKPLAN.md', 'old', 'new')
