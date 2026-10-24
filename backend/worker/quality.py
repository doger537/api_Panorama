from dataclasses import dataclass
from pathlib import Path
import math
import numpy as np
from PIL import Image
from backend.worker.runner import StitchError


@dataclass(frozen=True)
class StitchResult:
    image_path: Path
    width: int
    height: int
    vaov_deg: float
    v_offset_deg: float


def validate_control_points(pto: str) -> list[tuple[int, float, float, int, float, float]]:
    if sum(line.startswith('i ') for line in pto.splitlines()) != 16:
        raise StitchError('QUALITY_REJECTED', 'Expected all 16 frames in the stitch project')
    pairs: dict[tuple[int, int], int] = {}
    points = []
    for line in pto.splitlines():
        if not line.startswith('c '):
            continue
        values = {token[0]: float(token[1:]) for token in line.split()[1:] if token[0] in 'nNxyXYt'}
        if values.get('t', 0) != 0:
            continue  # Straight-line constraints do not prove image overlap.
        n, other = int(values['n']), int(values['N'])
        if n == other or not (0 <= n < 16 and 0 <= other < 16):
            raise StitchError('QUALITY_REJECTED', 'Invalid control-point image reference')
        point = (n, values['x'], values['y'], other, values['X'], values['Y'])
        if point in points:
            continue
        points.append(point)
        pair = tuple(sorted((n, other)))
        pairs[pair] = pairs.get(pair, 0) + 1
    if pairs.get((0, 15), 0) < 4:
        raise StitchError('LOOP_NOT_CLOSED', 'The first and last frames do not overlap sufficiently')
    if any(pairs.get((i, i + 1), 0) < 4 for i in range(15)):
        raise StitchError('NOT_ENOUGH_OVERLAP', 'Adjacent frames need at least four surviving control points')
    return points


def validate_reprojection(output: str, point_count: int, width: int = 4096) -> float:
    """Measure optimized control-point residuals in the final spherical canvas."""
    try:
        rows = [tuple(map(float, line.split())) for line in output.splitlines() if line.strip()]
        if len(rows) != point_count * 2 or any(len(row) != 2 or not all(map(math.isfinite, row))
                or not 0 <= row[1] <= width / 2 for row in rows):
            raise ValueError('Invalid transformed control points')
        errors = []
        for first, second in zip(rows[::2], rows[1::2]):
            dx = (first[0] - second[0] + width / 2) % width - width / 2
            errors.append(math.hypot(dx, first[1] - second[1]))
        rms = math.sqrt(sum(error ** 2 for error in errors) / len(errors))
    except (ValueError, ZeroDivisionError) as exc:
        raise StitchError('QUALITY_REJECTED', 'Control-point residuals could not be measured') from exc
    if rms > 12 or max(errors) > 48:
        raise StitchError('QUALITY_REJECTED', 'Control-point alignment error exceeds the quality limit')
    return rms


def measure_and_crop(source: Path, target: Path) -> StitchResult:
    with Image.open(source) as image:
        image.load()
        if image.size != (4096, 2048) or 'A' not in image.getbands():
            raise StitchError('QUALITY_REJECTED', 'A full spherical canvas with measurable alpha is required')
        alpha = np.asarray(image.getchannel('A'))
        rows = (alpha > 0).mean(axis=1) >= 0.98
        runs = []
        start = None
        for index, covered in enumerate([*rows, False]):
            if covered and start is None:
                start = index
            elif not covered and start is not None:
                runs.append((start, index))
                start = None
        if not runs:
            raise StitchError('INSUFFICIENT_COVERAGE', 'No continuous full-width coverage')
        top, bottom = max(runs, key=lambda run: run[1] - run[0])
        vaov = (bottom - top) * 360 / image.width
        offset = 90 - (top + bottom) / 2 * 360 / image.width
        if vaov < 40 or abs(offset) > 70:
            raise StitchError('INSUFFICIENT_COVERAGE', 'Measured vertical coverage is insufficient')
        image.crop((0, top, 4096, bottom)).save(target, 'PNG')
        return StitchResult(target, 4096, bottom - top, vaov, offset)
