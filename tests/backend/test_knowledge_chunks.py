"""content/knowledge — 청크 분할 로직."""

from app.content.knowledge import CHUNK_CHARS, split_chunks


def test_empty_text():
    assert split_chunks("") == []
    assert split_chunks("\n\n\n\n") == []


def test_short_text_single_chunk():
    chunks = split_chunks("짧은 문서입니다.")
    assert chunks == ["짧은 문서입니다."]


def test_paragraphs_grouped_under_limit():
    text = "\n\n".join(f"문단 {i} " + "가" * 100 for i in range(10))
    chunks = split_chunks(text)
    assert all(len(c) <= CHUNK_CHARS for c in chunks)
    assert len(chunks) >= 2


def test_long_paragraph_force_split():
    text = "가" * (CHUNK_CHARS * 3)
    chunks = split_chunks(text)
    assert all(len(c) <= CHUNK_CHARS for c in chunks)
    # 오버랩 분할이라 합치면 원본보다 길 수 있지만, 내용은 전부 포함돼야 함
    assert sum(len(c) for c in chunks) >= len(text)


def test_content_preserved():
    text = "첫 번째 문단.\n\n두 번째 문단."
    joined = "\n\n".join(split_chunks(text))
    assert "첫 번째 문단." in joined
    assert "두 번째 문단." in joined
