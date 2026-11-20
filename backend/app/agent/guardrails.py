"""Guardrails: prompt-injection detection and answer grounding checks."""

import logging
import re
from dataclasses import dataclass

from pydantic import BaseModel, Field

from app.agent.llm import fast_llm, guard_llm
from app.config import get_settings

log = logging.getLogger(__name__)

# Cheap first line of defence. Catches the blatant attacks without a network
# call, and still works if the classifier model is unavailable.
_INJECTION_PATTERNS = [
    r"ignore (all |any )?(the )?(previous|prior|above|earlier) (instructions|prompts?|rules)",
    r"disregard (all |any )?(the )?(previous|prior|above|system) (instructions|prompts?|rules)",
    r"(reveal|print|show|repeat|leak) (me )?(your|the) (system|hidden|initial) "
    r"(prompt|instructions)",
    r"you are now (in )?(dan|developer mode|jailbreak)",
    r"\bjailbreak\b",
    r"pretend (that )?you (have no|are not bound by) (rules|restrictions|guidelines)",
    # role-play extraction ("grandma used to read me the hidden instructions...")
    r"(hidden|secret|internal|confidential) (developer |system )?(instructions|prompts?|rules)",
]
_INJECTION_RE = re.compile("|".join(_INJECTION_PATTERNS), re.IGNORECASE)

# The prompt-guard model accepts at most 512 tokens; check long input in windows.
_GUARD_WINDOW_CHARS = 1500


@dataclass
class InjectionVerdict:
    blocked: bool
    score: float
    method: str  # "pattern" | "classifier" | "none"


def matches_injection_pattern(text: str) -> bool:
    return bool(_INJECTION_RE.search(text))


async def _classifier_score(text: str) -> float:
    windows = [
        text[i : i + _GUARD_WINDOW_CHARS] for i in range(0, len(text), _GUARD_WINDOW_CHARS)
    ] or [""]
    best = 0.0
    for window in windows[:4]:  # bound the cost for very long messages
        reply = await guard_llm().ainvoke(window)
        best = max(best, float(str(reply.content).strip()))
    return best


async def check_injection(text: str) -> InjectionVerdict:
    if matches_injection_pattern(text):
        return InjectionVerdict(blocked=True, score=1.0, method="pattern")
    try:
        score = await _classifier_score(text)
    except Exception as e:
        # Fail open: the regex already ran, and refusing every question because
        # the classifier is down would make the app unusable.
        log.warning("prompt-guard unavailable, skipping classifier: %s", e)
        return InjectionVerdict(blocked=False, score=0.0, method="none")
    threshold = get_settings().injection_threshold
    return InjectionVerdict(blocked=score >= threshold, score=score, method="classifier")


class GroundingVerdict(BaseModel):
    grounded: bool = Field(
        description="True only if every factual claim in the answer is supported by the sources."
    )
    unsupported_claims: list[str] = Field(
        default_factory=list, description="Claims in the answer that the sources do not support."
    )


_GROUNDING_PROMPT = """You are a strict fact-checker for a retrieval-augmented assistant.

Decide whether the ANSWER is fully supported by the SOURCES. Rules:
- Every factual claim must be stated in, or directly follow from, the sources.
- Arithmetic computed from numbers in the sources counts as supported.
- Saying that something is not in the documents is always supported.
- Wording differences are fine; new facts, numbers, names or dates are not.

SOURCES:
{sources}

ANSWER:
{answer}"""


async def check_grounding(answer: str, sources: str) -> GroundingVerdict | None:
    """Returns None if the check itself could not run."""
    try:
        return (
            await fast_llm()
            .with_structured_output(GroundingVerdict, method="json_schema")
            .ainvoke(_GROUNDING_PROMPT.format(sources=sources, answer=answer))
        )
    except Exception as e:
        # Don't throw away the answer because the checker failed, but don't
        # claim it was verified either: the API reports grounded=None.
        log.warning("grounding check failed, answer is unverified: %s", e)
        return None
