from io import BytesIO

from PIL import Image

from backend.app.modules.media.images import InvalidImage, make_variants


def _image(size: tuple[int, int], fmt: str = "PNG") -> bytes:
    image = Image.new("RGB", size, (40, 90, 130))
    out = BytesIO()
    image.save(out, format=fmt)
    return out.getvalue()


def test_plan_upload_is_reencoded_as_webp_derivatives():
    variants, width, height = make_variants(_image((640, 400)), "plan")
    assert (width, height) == (640, 400)
    assert set(variants) == {"preview", "mobile", "full"}
    assert all(data[:4] == b"RIFF" and data[8:12] == b"WEBP" for data in variants.values())


def test_panorama_requires_equirectangular_two_to_one():
    make_variants(_image((400, 200)), "panorama")
    try:
        make_variants(_image((400, 220)), "panorama")
    except InvalidImage:
        pass
    else:
        raise AssertionError("non-2:1 panorama was accepted")


def test_svg_is_not_accepted_as_raster_image():
    try:
        make_variants(b"<svg xmlns='http://www.w3.org/2000/svg'/>", "plan")
    except InvalidImage:
        pass
    else:
        raise AssertionError("SVG upload was accepted")
