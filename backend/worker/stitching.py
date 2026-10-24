"""The only production Hugin/enblend pipeline; caller owns its work directory."""
from pathlib import Path
import os
from PIL import Image, ImageOps
from typing import Callable
from backend.worker.runner import StitchError, run_command
from backend.worker.quality import StitchResult, measure_and_crop, validate_control_points, validate_reprojection


def stitch(frames: list[Path], work_root: Path, hfov_hint_deg: float = 60,
           checkpoint: Callable[[], None] = lambda: None,
           progress: Callable[[int], None] = lambda _: None) -> StitchResult:
    if len(frames) != 16 or any(not p.is_file() for p in frames):
        raise StitchError('INPUT_EXPIRED', 'The complete set of 16 source frames is unavailable')
    work_root.mkdir(parents=True, exist_ok=True)
    sources = []
    for index, source in enumerate(frames):
        target = work_root / f'frame-{index:02d}.jpg'
        # Bound feature extraction cost independently of phone resolution.
        # The original protected frame remains untouched.
        with Image.open(source) as image:
            image = ImageOps.exif_transpose(image).convert('RGB')
            image.thumbnail((800, 800), Image.Resampling.LANCZOS)
            image.save(target, 'JPEG', quality=90)
        sources.append(str(target))
    project = str(work_root / 'capture.pto')
    def run(args, percent, timeout=120):
        progress(percent)
        run_command(args, cwd=work_root, timeout=timeout, checkpoint=checkpoint)
    run(['pto_gen', f'--fov={hfov_hint_deg:g}', '-o', project, *sources], 10)
    # The multirow heuristic may omit the 15→0 seam. Sixteen frames are small
    # enough for the default exhaustive pair search, including the closing pair.
    run(['cpfind', f"--ncores={os.getenv('STITCH_THREADS', '2')}", '--sieve2size=3', '-o', project, project], 20, 300)
    run(['cpclean', '-o', project, project], 35)
    run(['autooptimiser', '-a', '-m', '-l', '-s', '-o', project, project], 45)
    points = validate_control_points(Path(project).read_text())
    run(['pano_modify', '--projection=2', '--fov=360x180', '--canvas=4096x2048', '--center', '-o', project, project], 55)
    coordinates = ''.join(f'{n} {x} {y}\n{other} {other_x} {other_y}\n'
                          for n, x, y, other, other_x, other_y in points)
    transformed = run_command(['pano_trafo', project], cwd=work_root, checkpoint=checkpoint, input_text=coordinates)
    rms = validate_reprojection(transformed, len(points))
    import logging
    logging.getLogger(__name__).info('control_points=%s rms_pixels=%.3f', len(points), rms)
    run(['nona', '-m', 'TIFF_m', '-o', str(work_root / 'render-'), project], 65, 180)
    tiles = sorted(work_root.glob('render-*.tif'))
    if len(tiles) != 16:
        raise StitchError('TOOL_FAILED', 'Renderer did not produce all frame tiles')
    output = work_root / 'stitched.tif'
    run(['enblend', '-f', '4096x2048+0+0', '--wrap=horizontal', '--compression=LZW', '-o', str(output), *map(str, tiles)], 80, 300)
    checkpoint()
    result = measure_and_crop(output, work_root / 'panorama.png')
    progress(95)
    return result
