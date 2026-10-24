"""Render the assignment board from its single machine-readable source."""
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]


def render():
    manifest = json.loads((ROOT / 'TASKS/manifest.json').read_text())
    lines = ['# TTKMap: план работ', '', '> Генерируется из manifest.json: `python scripts/render_workplan.py`. Статусы исторических задач не заменяют приёмку кода.', '']
    for task in manifest['tasks']:
        lines += [f"## {task['id']}: {task['title']}", '',
                  f"- Статус: {task.get('state', 'open')}",
                  '- Зависимости: ' + (', '.join(task['depends_on']) or 'нет'),
                  '- Область: ' + ', '.join(f'`{p}`' for p in task['allowed_paths']),
                  '- Проверка: ' + (f"`{task['verify_cmd']}`" if task['verify_cmd'] else 'приёмка на устройствах'), '', task['description'], '']
    return '\n'.join(lines)


if __name__ == '__main__':
    path = ROOT / 'TASKS/WORKPLAN.md'
    expected = render()
    if '--check' in sys.argv:
        if path.read_text() != expected:
            raise SystemExit('WORKPLAN is stale: run python scripts/render_workplan.py')
    else:
        path.write_text(expected)
