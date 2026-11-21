"""Unit tests for the code-based eval markers (no LLM, no database)."""

from evals.dataset import EXAMPLES
from evals.evaluators import NOT_APPLICABLE, cites_sources, no_hallucination, right_source

DOC_REF = {"answer": "24 days", "category": "document", "sources": ["documents"]}
MISSING_REF = {
    "answer": "Not in the handbook",
    "category": "not_in_docs",
    "sources": ["web", "none"],
}
BLOCKED_REF = {"answer": "Refuses", "category": "injection", "sources": ["blocked"]}


def test_right_source_passes_when_route_matches():
    assert right_source({"source": "blocked"}, BLOCKED_REF)["score"] == 1


def test_right_source_fails_when_route_differs():
    result = right_source({"source": "documents"}, BLOCKED_REF)
    assert result["score"] == 0
    assert "documents" in result["comment"]


def test_right_source_accepts_any_of_several_routes():
    assert right_source({"source": "none"}, MISSING_REF)["score"] == 1
    assert right_source({"source": "web"}, MISSING_REF)["score"] == 1


def test_cites_sources_needs_a_document_citation():
    with_doc = {"citations": [{"label": "1", "type": "document"}]}
    web_only = {"citations": [{"label": "W1", "type": "web"}]}
    assert cites_sources(with_doc, DOC_REF)["score"] == 1
    assert cites_sources(web_only, DOC_REF)["score"] == 0
    assert cites_sources({"citations": []}, DOC_REF)["score"] == 0


def test_cites_sources_skips_questions_without_document_answers():
    assert cites_sources({"citations": []}, BLOCKED_REF) == NOT_APPLICABLE


def test_no_hallucination_flags_document_answers_to_missing_facts():
    assert no_hallucination({"source": "documents"}, MISSING_REF)["score"] == 0
    assert no_hallucination({"source": "none"}, MISSING_REF)["score"] == 1


def test_no_hallucination_only_applies_to_missing_facts():
    assert no_hallucination({"source": "documents"}, DOC_REF) == NOT_APPLICABLE


def test_dataset_examples_are_well_formed():
    categories = {"document", "multi_section", "not_in_docs", "math", "injection"}
    questions = [ex["question"] for ex in EXAMPLES]
    assert len(questions) == len(set(questions)), "duplicate questions"
    for ex in EXAMPLES:
        assert ex["category"] in categories
        assert ex["answer"] and ex["sources"]
