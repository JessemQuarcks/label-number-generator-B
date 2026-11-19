import numpy as np
import pytest
from PIL import Image

from label_ai.errors import ApiError
from label_ai.imageio import (decode_image, decode_mask, encode_mask, encode_png, fit_size, paste_back,
                              resize_cover, to_mask)

from .conftest import data_url, decode_url


@pytest.mark.parametrize("fmt", ["PNG", "JPEG", "WEBP"])
def test_image_data_url_round_trip(synthetic_image, fmt):
    img = decode_image(data_url(synthetic_image, fmt))
    assert img.mode == "RGB" and img.size == synthetic_image.size
    back = decode_url(encode_png(img))
    assert back.size == synthetic_image.size
    if fmt == "PNG":
        assert np.array_equal(np.asarray(back), np.asarray(synthetic_image))


def test_rgba_image_is_composited_on_white():
    rgba = Image.new("RGBA", (8, 8), (255, 0, 0, 0))
    img = decode_image(data_url(rgba))
    assert img.getpixel((0, 0)) == (255, 255, 255)


def test_mask_uses_gray_values(square_mask):
    rgb = Image.merge("RGB", [square_mask] * 3)
    m = decode_mask(data_url(rgb))
    assert m.mode == "L" and np.array_equal(np.asarray(m), np.asarray(square_mask))


def test_mask_uses_alpha_when_colour_is_uniform(square_mask):
    # black strokes on a transparent canvas: colour uniform, information in alpha
    rgba = Image.new("RGBA", square_mask.size, (0, 0, 0, 0))
    rgba.putalpha(square_mask)
    m = to_mask(rgba)
    assert np.array_equal(np.asarray(m), np.asarray(square_mask))
    # white strokes with alpha: colour carries the mask
    rgba2 = Image.merge("RGBA", [square_mask] * 3 + [Image.new("L", square_mask.size, 255)])
    assert np.array_equal(np.asarray(to_mask(rgba2)), np.asarray(square_mask))


def test_mask_is_resized_to_image_size(square_mask):
    small = square_mask.resize((80, 60))
    m = decode_mask(data_url(small), size=(160, 120))
    assert m.size == (160, 120) and m.mode == "L"
    assert m.getpixel((80, 60)) > 200 and m.getpixel((5, 5)) < 20


def test_encode_mask_resizes_back():
    arr = np.zeros((30, 40), np.float32)
    arr[10:20, 10:30] = 1.0
    out = decode_url(encode_mask(arr, size=(160, 120)))
    assert out.mode == "L" and out.size == (160, 120)
    assert out.getpixel((80, 60)) == 255 and out.getpixel((2, 2)) == 0


def test_fit_size_multiples_and_caps():
    assert fit_size(4000, 3000, max_side=1024, multiple=8) == (1024, 768)
    w, h = fit_size(300, 200, max_side=1024, multiple=64, target_area=1024 * 1024)
    assert w % 64 == 0 and h % 64 == 0 and max(w, h) <= 1024 and abs(w / h - 1.5) < 0.2
    assert fit_size(100, 50, max_side=1024, multiple=8) == (104, 48) or fit_size(100, 50, max_side=1024, multiple=8) == (96, 48)
    w, h = fit_size(2048, 64, max_side=1536, multiple=16, target_area=1024 * 1024)
    assert w <= 1536 and w % 16 == 0 and h % 16 == 0


def test_resize_cover_exact_size(synthetic_image):
    out = resize_cover(synthetic_image, (300, 50))
    assert out.size == (300, 50)


def test_paste_back_keeps_pixels_outside_mask(synthetic_image, square_mask):
    gen = Image.new("RGB", (64, 48), (0, 255, 0))  # different size on purpose
    out = paste_back(synthetic_image, gen, square_mask, feather_px=1)
    assert out.size == synthetic_image.size
    assert out.getpixel((2, 2)) == synthetic_image.getpixel((2, 2))
    assert out.getpixel((80, 60)) == (0, 255, 0)


@pytest.mark.parametrize("bad", ["", "hello", "data:text/plain;base64,aGVsbG8=", "data:image/png;base64,!!!notpng"])
def test_bad_data_urls_are_400(bad):
    with pytest.raises(ApiError) as e:
        decode_image(bad)
    assert e.value.status == 400 and e.value.code == "bad_request"


def test_oversized_image_rejected():
    with pytest.raises(ApiError) as e:
        decode_image(data_url(Image.new("L", (4097, 2))))
    assert e.value.status == 400 and "4096" in e.value.message
