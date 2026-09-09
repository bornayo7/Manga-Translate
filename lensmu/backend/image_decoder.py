"""Decode bounded raster input before an OCR model is constructed."""

import io

from PIL import Image

MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024
MAX_IMAGE_PIXELS = 16_000_000
MAX_IMAGE_SIDE = 16_384
SUPPORTED_FORMATS = {"PNG", "JPEG", "WEBP"}


class ImageInputError(ValueError):
    def __init__(self, message: str, *, too_large: bool = False):
        super().__init__(message)
        self.too_large = too_large


def decode_image(image_bytes: bytes) -> Image.Image:
    """Return an owned RGB image; the caller closes it after recognition.

    Header dimensions are checked before decoding pixels. Transparent input is
    composited on white so its visible text, rather than hidden RGB channels,
    reaches the recognizer. Coordinates remain in the supplied image's space.
    """
    if len(image_bytes) > MAX_IMAGE_SIZE_BYTES:
        raise ImageInputError("Image exceeds the 10 MB limit.", too_large=True)
    try:
        with Image.open(io.BytesIO(image_bytes)) as source:
            if source.format not in SUPPORTED_FORMATS:
                raise ImageInputError("Unsupported image format. Use PNG, JPEG, or WebP.")
            width, height = source.size
            if (
                width <= 0 or height <= 0
                or width > MAX_IMAGE_SIDE or height > MAX_IMAGE_SIDE
                or width * height > MAX_IMAGE_PIXELS
            ):
                raise ImageInputError(
                    f"Image dimensions exceed {MAX_IMAGE_PIXELS:,} pixels or "
                    f"{MAX_IMAGE_SIDE:,} pixels on one side. Resize the image first.",
                    too_large=True,
                )
            source.load()  # corrupt/truncated pixels fail before any model load
            if source.mode in ("RGBA", "LA") or "transparency" in source.info:
                with source.convert("RGBA") as rgba:
                    result = Image.new("RGB", source.size, "white")
                    with rgba.getchannel("A") as alpha:
                        result.paste(rgba, mask=alpha)
                    return result
            return source.convert("RGB")
    except ImageInputError:
        raise
    except Image.DecompressionBombError as error:
        raise ImageInputError("Image exceeds the decoded pixel limit.", too_large=True) from error
    except (OSError, ValueError, SyntaxError) as error:
        raise ImageInputError("Could not decode image. Use an intact PNG, JPEG, or WebP.") from error
