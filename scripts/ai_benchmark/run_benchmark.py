#!/usr/bin/env python3
"""
Runs the Web Design OS local-model benchmark (see prompts.py) against a
reachable Ollama server, using Ollama's OpenAI-compatible endpoint
(/v1/chat/completions with response_format=json_schema) -- the same
integration style the production Ollama provider (see T3) is expected
to use, so results here are representative.

This script makes network calls but touches no application code and is
not imported by apps/api or apps/web -- it's an operator tool for
choosing/validating AI_LOCAL_MODEL, not part of the request path.

Usage:
    python run_benchmark.py --base-url http://<host>:11434 \\
        --models qwen3:14b,qwen3:30b,gpt-oss:20b \\
        --output results.json

    # Or against a single already-known-good model:
    python run_benchmark.py --base-url http://<host>:11434 --models qwen3:14b

Requires: httpx (already a backend dependency, see apps/api/requirements.txt)
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import httpx

sys.path.insert(0, str(Path(__file__).parent))
from prompts import CASES  # noqa: E402

DEFAULT_TIMEOUT_S = 120.0


@dataclass
class CaseResult:
    model: str
    case_name: str
    ok: bool
    latency_s: float | None
    schema_valid: bool
    raw_output: str | None
    parsed_output: dict[str, Any] | None
    error: str | None


def _validate_against_schema(instance: Any, schema: dict[str, Any]) -> tuple[bool, str | None]:
    """Minimal structural check (type/required/additionalProperties at the
    top level) -- enough to catch a model that ignored the schema entirely,
    without adding a jsonschema dependency for a benchmark-only script."""
    if schema.get("type") == "object":
        if not isinstance(instance, dict):
            return False, f"expected object, got {type(instance).__name__}"
        for key in schema.get("required", []):
            if key not in instance:
                return False, f"missing required field '{key}'"
        if schema.get("additionalProperties") is False:
            allowed = set(schema.get("properties", {}).keys())
            extra = set(instance.keys()) - allowed
            if extra:
                return False, f"unexpected fields: {sorted(extra)}"
    return True, None


def _call_model(base_url: str, model: str, case: dict[str, Any], timeout_s: float) -> CaseResult:
    url = f"{base_url.rstrip('/')}/v1/chat/completions"
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": case["system"]},
            {"role": "user", "content": case["user"]},
        ],
        "temperature": 0.2,
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": case["name"],
                "schema": case["json_schema"],
                "strict": True,
            },
        },
    }
    start = time.monotonic()
    try:
        resp = httpx.post(url, json=payload, timeout=timeout_s)
        latency_s = time.monotonic() - start
        resp.raise_for_status()
        data = resp.json()
        content = data["choices"][0]["message"]["content"]
        parsed = json.loads(content)
        schema_valid, schema_error = _validate_against_schema(parsed, case["json_schema"])
        return CaseResult(
            model=model,
            case_name=case["name"],
            ok=True,
            latency_s=latency_s,
            schema_valid=schema_valid,
            raw_output=content,
            parsed_output=parsed if schema_valid else None,
            error=schema_error,
        )
    except httpx.TimeoutException:
        return CaseResult(
            model=model,
            case_name=case["name"],
            ok=False,
            latency_s=time.monotonic() - start,
            schema_valid=False,
            raw_output=None,
            parsed_output=None,
            error=f"timed out after {timeout_s}s",
        )
    except (httpx.HTTPError, json.JSONDecodeError, KeyError, IndexError) as exc:
        return CaseResult(
            model=model,
            case_name=case["name"],
            ok=False,
            latency_s=time.monotonic() - start,
            schema_valid=False,
            raw_output=None,
            parsed_output=None,
            error=f"{type(exc).__name__}: {exc}",
        )


def run_benchmark(base_url: str, models: list[str], timeout_s: float = DEFAULT_TIMEOUT_S) -> list[CaseResult]:
    results: list[CaseResult] = []
    for model in models:
        for case in CASES:
            print(f"  [{model}] {case['name']} ...", file=sys.stderr, end=" ", flush=True)
            result = _call_model(base_url, model, case, timeout_s)
            status = "ok" if result.ok and result.schema_valid else "FAIL"
            latency = f"{result.latency_s:.1f}s" if result.latency_s is not None else "?"
            print(f"{status} ({latency})", file=sys.stderr)
            results.append(result)
    return results


def summarize(results: list[CaseResult]) -> dict[str, Any]:
    by_model: dict[str, dict[str, Any]] = {}
    for r in results:
        m = by_model.setdefault(
            r.model, {"total": 0, "ok": 0, "schema_valid": 0, "latencies": []}
        )
        m["total"] += 1
        if r.ok:
            m["ok"] += 1
        if r.schema_valid:
            m["schema_valid"] += 1
        if r.latency_s is not None:
            m["latencies"].append(r.latency_s)
    summary = {}
    for model, m in by_model.items():
        latencies = m["latencies"]
        summary[model] = {
            "requests_ok": f"{m['ok']}/{m['total']}",
            "schema_valid": f"{m['schema_valid']}/{m['total']}",
            "avg_latency_s": round(sum(latencies) / len(latencies), 2) if latencies else None,
            "max_latency_s": round(max(latencies), 2) if latencies else None,
        }
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", required=True, help="e.g. http://192.168.1.50:11434")
    parser.add_argument("--models", required=True, help="comma-separated Ollama model tags")
    parser.add_argument("--output", default="benchmark_results.json", help="path to write full JSON results")
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT_S)
    args = parser.parse_args()

    models = [m.strip() for m in args.models.split(",") if m.strip()]
    print(f"Running {len(CASES)} cases x {len(models)} model(s) against {args.base_url}", file=sys.stderr)

    results = run_benchmark(args.base_url, models, args.timeout)
    summary = summarize(results)

    output_path = Path(args.output)
    output_path.write_text(
        json.dumps(
            {
                "summary": summary,
                "results": [asdict(r) for r in results],
            },
            indent=2,
        )
    )

    print("\n=== Summary (mechanical checks only -- still needs human/rubric scoring) ===", file=sys.stderr)
    for model, s in summary.items():
        print(f"{model}: requests_ok={s['requests_ok']} schema_valid={s['schema_valid']} "
              f"avg_latency={s['avg_latency_s']}s max_latency={s['max_latency_s']}s", file=sys.stderr)
    print(f"\nFull results + raw outputs written to {output_path}", file=sys.stderr)
    print("Next: score each case's raw_output by hand against score_rubric.md "
          "(accuracy, hallucination, instruction-following, business-writing quality).", file=sys.stderr)


if __name__ == "__main__":
    main()
