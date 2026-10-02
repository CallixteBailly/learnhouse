"""
Unit tests for the extended video-format support.

Covers: container magic-byte validation for every accepted video format,
extension→MIME→stored-filename round-trips (so no upload silently becomes
".bin"), the extension-first activity gate (browsers send inconsistent MIME
types for mkv/avi/mov), and aspect-ratio-aware sprite cell sizing.
"""

import io

import pytest
from fastapi import HTTPException

from src.security.file_validation import (
    EXT_TO_CANONICAL_MIME,
    FILE_TYPES,
    MIME_TO_SAFE_EXT,
    VIDEO_FILE_FORMATS,
    get_safe_filename,
    validate_upload,
    validate_video_content,
)
from src.services.utils.hls_transcode import sprite_cell_size

VIDEO_TYPES = ["video"]


class _FakeUpload:
    def __init__(self, filename, data, content_type="application/octet-stream"):
        self.filename = filename
        self.content_type = content_type
        self.file = io.BytesIO(data)
        self.size = len(data)


def _mp4(brand=b"isom"):
    return b"\x00\x00\x00\x20ftyp" + brand + b"\x00" * 16


# (container name, valid header bytes, stored extension)
_NEW_FORMATS = [
    ("mp4", _mp4(b"isom"), "mp4"),
    ("mp4-brand-mp41", _mp4(b"mp41"), "mp4"),
    ("m4v", _mp4(b"M4V "), "m4v"),
    ("mov-ftyp", _mp4(b"qt  "), "mov"),
    ("mov-legacy-atom", b"\x00\x00\x00\x10moov" + b"\x00" * 8, "mov"),
    ("mov-legacy-mdat", b"\x00\x00\x00\x10mdat" + b"\x00" * 8, "mov"),
    ("webm", b"\x1a\x45\xdf\xa3" + b"\x00" * 16, "webm"),
    ("mkv", b"\x1a\x45\xdf\xa3" + b"\x01\x42\x85" + b"\x00" * 8, "mkv"),
    ("avi", b"RIFF\x24\x08\x00\x00AVI " + b"\x00" * 8, "avi"),
    ("wmv", b"\x30\x26\xb2\x75\x8e\x66\xcf\x11" + b"\xa6\xd9\x00\xaa\x00\x62\xce\x6c", "wmv"),
    ("flv", b"FLV\x01\x05\x00\x00\x00\x09\x00\x00\x00\x00", "flv"),
    ("ogv", b"OggS" + b"\x00" * 12, "ogv"),
    ("mpeg-ps", b"\x00\x00\x01\xba" + b"\x21\x00" * 4, "mpeg"),
    ("mpeg-es", b"\x00\x00\x01\xb3" + b"\x21\x00" * 4, "mpeg"),
    ("3gp", _mp4(b"3gp4"), "3gp"),
]


class TestVideoMagicBytes:
    @pytest.mark.parametrize("name,header,_ext", _NEW_FORMATS, ids=[f[0] for f in _NEW_FORMATS])
    def test_accepts_container_header(self, name, header, _ext):
        assert validate_video_content(header + b"\x00" * 64)

    @pytest.mark.parametrize(
        "junk",
        [
            b"MZ\x90\x00" + b"\x00" * 16,          # PE executable
            b"%PDF-1.7" + b"\x00" * 8,             # PDF
            b"just some plain text" + b"\x00" * 4,  # text
            b"\x00" * 12,                           # empty-ish
            b"GIF89a" + b"\x00" * 8,               # image, not video
        ],
        ids=["pe", "pdf", "text", "zeros", "gif"],
    )
    def test_rejects_non_video_bytes(self, junk):
        assert not validate_video_content(junk)


class TestVideoUploadRoundTrip:
    @pytest.mark.parametrize(
        "filename,header,stored_ext",
        [(f"clip.{name.split('-')[0]}", hdr, ext) for name, hdr, ext in _NEW_FORMATS],
        ids=[f[0] for f in _NEW_FORMATS],
    )
    def test_upload_stores_canonical_extension(self, filename, header, stored_ext):
        # Browsers report inconsistent content types (mkv as octet-stream, mov
        # as video/quicktime) — the gate must not depend on the client MIME.
        upload = _FakeUpload(filename, header + b"\x00" * 64, content_type="application/octet-stream")
        ctype, _content = validate_upload(upload, VIDEO_TYPES)
        stored = get_safe_filename(filename, "uuid_block", content_type=ctype)
        assert stored == f"uuid_block.{stored_ext}"

    def test_rejects_disguised_video(self):
        with pytest.raises(HTTPException) as exc:
            validate_upload(_FakeUpload("evil.mkv", b"definitely not matroska" * 2), VIDEO_TYPES)
        assert exc.value.status_code == 415

    def test_rejects_unknown_video_extension(self):
        with pytest.raises(HTTPException) as exc:
            validate_upload(_FakeUpload("clip.ts", _mp4()), VIDEO_TYPES)
        assert exc.value.status_code == 415


class TestVideoFormatRegistry:
    def test_registry_matches_extension_list(self):
        assert VIDEO_FILE_FORMATS == [e.lstrip(".") for e in FILE_TYPES["video"]["extensions"]]

    def test_every_extension_maps_to_canonical_mime(self):
        for ext in FILE_TYPES["video"]["extensions"]:
            assert ext in EXT_TO_CANONICAL_MIME, f"{ext} missing canonical MIME"

    def test_every_video_mime_maps_to_safe_ext(self):
        for mime in FILE_TYPES["video"]["mime_types"]:
            assert mime in MIME_TO_SAFE_EXT, f"{mime} missing safe extension"
            safe = MIME_TO_SAFE_EXT[mime]
            assert f".{safe}" in FILE_TYPES["video"]["extensions"], (
                f"{mime} maps to non-video .{safe}"
            )

    def test_canonical_round_trip_is_stable(self):
        # .mpg and .mpeg share the canonical video/mpeg → stored as .mpeg.
        aliases = {".mpg": "mpeg"}
        for ext in FILE_TYPES["video"]["extensions"]:
            mime = EXT_TO_CANONICAL_MIME[ext]
            assert MIME_TO_SAFE_EXT[mime] == aliases.get(ext, ext.lstrip(".")), (
                f"{ext} round-trip broken"
            )


class TestActivityVideoGate:
    def test_extension_first_accepts_octet_stream_mkv(self):
        from src.services.courses.activities.video import _is_supported_video_file

        upload = _FakeUpload("movie.mkv", b"\x1a\x45\xdf\xa3" + b"\x00" * 16, "application/octet-stream")
        assert _is_supported_video_file(upload)

    def test_gate_rejects_missing_extension(self):
        from src.services.courses.activities.video import _is_supported_video_file

        assert not _is_supported_video_file(_FakeUpload("noext", _mp4()))

    def test_gate_rejects_other_extensions(self):
        from src.services.courses.activities.video import _is_supported_video_file

        assert not _is_supported_video_file(_FakeUpload("image.png", _mp4()))


class TestSpriteCellSize:
    def test_landscape_keeps_legacy_160x90(self):
        assert sprite_cell_size(1920, 1080) == (160, 90)

    def test_portrait_swaps_dimensions(self):
        assert sprite_cell_size(1080, 1920) == (90, 160)

    def test_square(self):
        assert sprite_cell_size(1080, 1080) == (90, 90)

    def test_ultrawide_is_clamped(self):
        w, h = sprite_cell_size(3840, 1080)  # 32:9
        assert h == 90
        assert w <= 320

    def test_unknown_dimensions_fall_back_to_default(self):
        assert sprite_cell_size(0, 0) == (160, 90)
