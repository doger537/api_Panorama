# Stitch fixtures

See manifest.json for every source filename and SHA-256; provenance details and limits are in docs/capture_samples.md.

series_01 is a real-photo series; negative_duplicates and negative_incomplete are derived negative cases. No empty directory is counted as a fixture. Successful stitching is verified by backend/tests/stitch/test_pipeline.py with actual Hugin/enblend in the worker image. The output is measured, never declared 180° by default.
