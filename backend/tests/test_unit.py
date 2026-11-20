"""Fast unit tests: no database or ML models required."""

import uuid

import jwt
import pytest

from app.ingestion import UnsupportedFileType, chunk_pages, extract_pages
from app.retrieval import reciprocal_rank_fusion
from app.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)


def test_rrf_rewards_items_ranked_high_in_both_lists():
    a, b, c, d = (uuid.uuid4() for _ in range(4))
    fused = reciprocal_rank_fusion([[a, b, c], [b, d, a]])
    assert fused[0] in (a, b)
    assert set(fused[:2]) == {a, b}
    assert set(fused) == {a, b, c, d}


def test_rrf_handles_empty_lists():
    assert reciprocal_rank_fusion([[], []]) == []


def test_extract_txt_and_strip_nul_bytes():
    pages = extract_pages(b"hello\x00 world", "notes.txt")
    assert pages == [(None, "hello world")]


def test_extract_rejects_unknown_extension():
    with pytest.raises(UnsupportedFileType):
        extract_pages(b"data", "image.png")


def test_chunking_keeps_page_numbers_and_skips_empty_pages():
    long_text = "word " * 600  # ~3000 chars -> several chunks
    chunks = chunk_pages([(1, long_text), (2, ""), (3, "short page")])
    assert len(chunks) > 2
    assert {c.page for c in chunks} == {1, 3}
    assert all(len(c.content) <= 1000 for c in chunks)


def test_password_hash_roundtrip():
    h = hash_password("correct horse battery")
    assert verify_password("correct horse battery", h)
    assert not verify_password("wrong password", h)


def test_token_roundtrip_and_tamper_detection():
    uid = uuid.uuid4()
    token = create_access_token(uid)
    assert decode_access_token(token) == uid
    with pytest.raises(jwt.InvalidTokenError):
        decode_access_token(token + "x")
