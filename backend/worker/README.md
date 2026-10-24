# Worker

`main.py` claims durable jobs and uses `JobLease` for heartbeat, progress, expiry and commit. `runner.py` starts tools without a shell and terminates their process groups on cancellation, lease loss or timeout. `stitching.py` is the only Hugin/enblend pipeline. `quality.py` measures coverage and crops without stretching a partial panorama into 180° vertically.

Enblend explicitly produces a 4096×2048 alpha canvas before measurement. Adjacent frames and the closing seam require at least four surviving control points; usable rows require ≥98% horizontal alpha coverage and ≥40° contiguous vertical coverage. Optimized control-point reprojection is measured with `pano_trafo` on the final spherical canvas (RMS ≤12 px, maximum ≤48 px, horizontal wrap included). These checks do not replace visual inspection of seams on physical-device acceptance.

A failed job stays failed, retry is bounded by the capture API. No stale/expired token can commit. Assets written by a cancelled worker are removed; crash orphans are handled by maintenance GC. Tests: `backend/tests/stitch`, including the real `series_01` fixture in the worker image.
