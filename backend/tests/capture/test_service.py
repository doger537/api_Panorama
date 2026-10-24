from io import BytesIO

from PIL import Image

from backend.app.modules.capture.service import normalize_frame


def test_frame_exif_orientation_is_applied_and_hash_is_of_original():
    image = Image.new("RGB", (80, 40), "red")
    exif = Image.Exif()
    exif[274] = 6
    output = BytesIO()
    image.save(output, format="JPEG", exif=exif)
    raw = output.getvalue()
    normalized, width, height, digest = normalize_frame(raw)
    assert (width, height) == (40, 80)
    assert digest
    with Image.open(BytesIO(normalized)) as decoded:
        assert decoded.size == (40, 80)
        assert not decoded.getexif()


def test_frame_rejects_svg():
    try:
        normalize_frame(b"<svg/>")
    except ValueError:
        pass
    else:
        raise AssertionError("SVG frame was accepted")
