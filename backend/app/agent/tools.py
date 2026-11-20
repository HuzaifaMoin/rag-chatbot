"""Tools the agent can call when the user's documents don't hold the answer."""

import ast
import asyncio
import logging
import math
import operator
import re
import time

from langchain_core.tools import tool

from app.config import get_settings

log = logging.getLogger(__name__)

# --- Calculator -------------------------------------------------------------
# Evaluates arithmetic by walking the AST with a whitelist, so it can never run
# arbitrary code the way eval() would.

_BIN_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}
_UNARY_OPS = {ast.UAdd: operator.pos, ast.USub: operator.neg}
_FUNCS = {
    "sqrt": math.sqrt,
    "log": math.log,
    "log10": math.log10,
    "exp": math.exp,
    "sin": math.sin,
    "cos": math.cos,
    "tan": math.tan,
    "abs": abs,
    "round": round,
    "min": min,
    "max": max,
}
_CONSTS = {"pi": math.pi, "e": math.e}
_MAX_EXPONENT = 1000
_MAX_LEN = 300
_THOUSANDS_RE = re.compile(r"(?<=\d),(?=\d{3}(?!\d))")


class CalculatorError(ValueError):
    pass


def _eval(node: ast.AST) -> float:
    match node:
        case ast.Expression(body=body):
            return _eval(body)
        case ast.Constant(value=v) if isinstance(v, int | float) and not isinstance(v, bool):
            return v
        case ast.Name(id=name) if name in _CONSTS:
            return _CONSTS[name]
        case ast.BinOp(left=left, op=op, right=right) if type(op) in _BIN_OPS:
            lhs, rhs = _eval(left), _eval(right)
            if isinstance(op, ast.Pow) and abs(rhs) > _MAX_EXPONENT:
                raise CalculatorError("exponent too large")
            return _BIN_OPS[type(op)](lhs, rhs)
        case ast.UnaryOp(op=op, operand=operand) if type(op) in _UNARY_OPS:
            return _UNARY_OPS[type(op)](_eval(operand))
        case ast.Call(func=ast.Name(id=fn), args=args, keywords=[]) if fn in _FUNCS:
            return _FUNCS[fn](*(_eval(a) for a in args))
    raise CalculatorError(f"unsupported expression: {ast.dump(node)[:80]}")


def safe_calculate(expression: str) -> float:
    # "1,250" -> "1250", but keep the comma in "round(pi, 2)".
    expression = _THOUSANDS_RE.sub("", expression.replace("^", "**")).strip()
    if len(expression) > _MAX_LEN:
        raise CalculatorError("expression too long")
    try:
        tree = ast.parse(expression, mode="eval")
    except SyntaxError as e:
        raise CalculatorError(f"invalid expression: {e.msg}") from None
    try:
        return _eval(tree)
    except (ZeroDivisionError, OverflowError, TypeError) as e:
        raise CalculatorError(str(e)) from None


@tool
def calculator(expression: str) -> str:
    """Evaluate an arithmetic expression exactly, e.g. "(1200 * 0.15) + 40" or "sqrt(2) * pi".

    Supports + - * / // % ** (or ^), parentheses, pi, e and the functions
    sqrt, log, log10, exp, sin, cos, tan, abs, round, min, max.
    Use this instead of doing arithmetic in your head.
    """
    try:
        result = safe_calculate(expression)
    except CalculatorError as e:
        return f"Error: {e}"
    if isinstance(result, float) and result.is_integer() and abs(result) < 1e15:
        result = int(result)
    return str(result)


# --- Web search -------------------------------------------------------------


def _ddg_search(query: str, max_results: int) -> list[dict]:
    from ddgs import DDGS  # imported lazily: it's slow to import
    from ddgs.exceptions import DDGSException

    # The free endpoints are flaky and sometimes return "No results found." for
    # queries that work a second later, so retry once before giving up.
    for attempt in range(2):
        try:
            return list(DDGS().text(query, max_results=max_results))
        except DDGSException as e:
            if attempt == 1:
                if "no results" in str(e).lower():
                    return []
                raise
            time.sleep(1)
    return []


async def search_web(query: str) -> list[dict]:
    """Return [{title, url, snippet}] (empty if nothing found). Raises on network errors."""
    raw = await asyncio.to_thread(_ddg_search, query, get_settings().web_search_results)
    return [
        {"title": r.get("title", ""), "url": r.get("href", ""), "snippet": r.get("body", "")}
        for r in raw
        if r.get("href")
    ]


def format_web_results(results: list[dict], start: int) -> str:
    """Number results from `start` so labels stay unique across several searches."""
    if not results:
        return "No results."
    return "\n\n".join(
        f"[W{i}] {r['title']}\nURL: {r['url']}\n{r['snippet']}"
        for i, r in enumerate(results, start=start)
    )


@tool
async def web_search(query: str) -> str:
    """Search the public web (DuckDuckGo). Use ONLY when the user's documents don't
    contain the answer and the question needs current or general-knowledge facts.

    Returns numbered results with title, URL and snippet. Cite them as [W1], [W2]...
    """
    # The agent loop runs searches itself (see graph.py) so it can number results
    # across calls and keep their URLs for citations. This body is the fallback.
    try:
        return format_web_results(await search_web(query), start=1)
    except Exception as e:
        log.warning("web search failed: %s", e)
        return "Error: web search is unavailable right now."
