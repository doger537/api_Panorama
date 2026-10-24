from __future__ import annotations

from io import BytesIO
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError


class InvalidImage(ValueError):
    pass


def make_variants(
    raw: bytes,
    kind: str,
    *,
    partial_vaov_deg: float | None = None,
) -> tuple[dict[str, bytes], int, int]:
    """Decode and normalize an upload; re-encoding strips EXIF/GPS and metadata."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(raw)) as image:
                if image.format not in {"JPEG", "PNG", "WEBP"}:
                    raise InvalidImage("Only JPEG, PNG and WebP are accepted")
                if image.width > 8192 or image.height > 8192 or image.width * image.height > 40_000_000:
                    raise InvalidImage("Image dimensions exceed the limit")
                image.verify()
            with Image.open(BytesIO(raw)) as image:
                image = ImageOps.exif_transpose(image)
                image.load()
                if image.width > 8192 or image.height > 8192 or image.width * image.height > 40_000_000:
                    raise InvalidImage("Image dimensions exceed the limit")
                if kind == "panorama":
                    partial = partial_vaov_deg is not None
                    valid_extent = (
                        image.width <= 8192 and 40 <= partial_vaov_deg <= 180
                        and abs(image.height - image.width * partial_vaov_deg / 360) <= 1.5
                    ) if partial else image.width == image.height * 2
                    if not valid_extent:
                        expected = "a measured partial panorama" if partial else "equirectangular 2:1"
                        raise InvalidImage(f"Panorama must be {expected} and at most 4096 pixels")
                image.thumbnail((4096, 4096), Image.Resampling.LANCZOS)
                width, height = image.size
                if kind == "plan" and ("A" in image.getbands() or "transparency" in image.info):
                    rgba = image.convert("RGBA")
                    background = Image.new("RGBA", rgba.size, "white")
                    image = Image.alpha_composite(background, rgba).convert("RGB")
                else:
                    image = image.convert("RGB")
                result: dict[str, bytes] = {}
                for name, bound in (("preview", 512), ("mobile", 1600), ("full", 4096)):
                    variant = image.copy()
                    variant.thumbnail((bound, bound), Image.Resampling.LANCZOS)
                    output = BytesIO()
                    variant.save(output, format="WEBP", quality=84 if name != "full" else 90, method=5)
                    result[name] = output.getvalue()
                return result, width, height
    except InvalidImage:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError,
            Image.DecompressionBombWarning) as exc:
        raise InvalidImage("Image cannot be decoded safely") from exc
