from pathlib import Path
from io import BytesIO
import shutil
import pytest
from PIL import Image
from backend.worker.quality import measure_and_crop, validate_reprojection
from backend.worker.runner import StitchError
from backend.worker.stitching import stitch

FIXTURES = Path(__file__).parents[1] / 'fixtures/stitch'


def test_measured_coverage_not_full_sphere(tmp_path):
    image = Image.new('RGBA', (4096, 2048), (0, 0, 0, 0))
    image.paste((100, 110, 120, 255), (0, 600, 4096, 1400))
    image.save(tmp_path / 'input.png')
    result = measure_and_crop(tmp_path / 'input.png', tmp_path / 'output.png')
    assert result.height == 800
    assert result.vaov_deg == 800 * 360 / 4096
    assert result.v_offset_deg == 90 - 1000 * 360 / 4096


def test_reprojection_wraps_horizontal_seam_and_rejects_bad_alignment():
    assert validate_reprojection('4095 1000\n1 1000\n', 1) == 2
    with pytest.raises(StitchError, match='quality limit'):
        validate_reprojection('100 100\n200 100\n', 1)
    with pytest.raises(StitchError, match='could not be measured'):
        validate_reprojection('nan 100\n200 100\n', 1)


def test_real_fixture_stitch(tmp_path):
    assert shutil.which('pto_gen'), 'Run this required integration test in the worker/test Docker image'
    frames = []
    for i in range(16):
        source = FIXTURES / 'series_01' / f'photo_{i+1}_2026-10-24_08-13-40.jpg'
        target = tmp_path / f'frame{i}.jpg'
        with Image.open(source) as image:
            image.thumbnail((600, 800))
            image.convert('RGB').save(target, 'JPEG', quality=90)
        frames.append(target)
    result = stitch(frames, tmp_path / 'work', 65)
    assert result.width == 4096
    assert 40 <= result.vaov_deg < 180
    assert result.height == pytest.approx(result.width * result.vaov_deg / 360)
    assert result.image_path.is_file()


def test_incomplete_series_rejected(tmp_path):
    with pytest.raises(StitchError, match='complete set'):
        stitch([], tmp_path)


def test_fixture_manifest_hashes_and_missing_files():
    import json
    import hashlib
    manifest=json.loads((FIXTURES/'manifest.json').read_text())
    for series in manifest['series']:
        assert len(series['frames'])==16
        for frame in series['frames']:
            path=FIXTURES/series['id']/frame['filename']
            assert hashlib.sha256(path.read_bytes()).hexdigest()==frame['sha256']
    for case in manifest['negative_cases']:
        assert case['frames']
        for frame in case['frames']:
            path = FIXTURES / case['directory'] / frame['filename']
            assert hashlib.sha256(path.read_bytes()).hexdigest() == frame['sha256']
