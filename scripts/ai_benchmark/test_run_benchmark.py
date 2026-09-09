"""
Tests for the benchmark harness itself (not against a live Ollama server --
none is provisioned yet, see T2 report). Uses httpx.MockTransport to stand
in for an OpenAI-compatible /v1/chat/completions endpoint so the harness's
request shape, schema validation, error handling, and summary output are
verified without any network dependency.

Run with: python -m pytest scripts/ai_benchmark/test_run_benchmark.py -v
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).parent))
from prompts import CASES  # noqa: E402
from run_benchmark import _call_model, _validate_against_schema, run_benchmark, summarize  # noqa: E402

FIRST_CASE = CASES[0]


def _make_client_with_transport(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


class TestValidateAgainstSchema:
    def test_valid_object_passes(self):
        ok, err = _validate_against_schema({"summary": "hi"}, FIRST_CASE["json_schema"])
        assert ok is True
        assert err is None

    def test_missing_required_field_fails(self):
        ok, err = _validate_against_schema({}, FIRST_CASE["json_schema"])
        assert ok is False
        assert "summary" in err

    def test_unexpected_field_fails(self):
        schema = FIRST_CASE["json_schema"]
        ok, err = _validate_against_schema({"summary": "hi", "extra": "nope"}, schema)
        assert ok is False
        assert "extra" in err

    def test_wrong_top_level_type_fails(self):
        ok, err = _validate_against_schema(["not", "an", "object"], FIRST_CASE["json_schema"])
        assert ok is False
        assert "expected object" in err


class TestCallModel:
    def test_successful_call_parses_and_validates(self, monkeypatch):
        def handler(request: httpx.Request) -> httpx.Response:
            body = json.loads(request.content)
            assert body["model"] == "qwen3:14b"
            assert body["response_format"]["json_schema"]["name"] == FIRST_CASE["name"]
            assert body["messages"][0]["role"] == "system"
            assert body["messages"][1]["role"] == "user"
            content = json.dumps({"summary": "The site was unreachable during the audit."})
            return httpx.Response(
                200,
                json={
                    "choices": [{"message": {"content": content}}],
                },
            )

        monkeypatch.setattr(httpx, "post", lambda url, json, timeout: _make_client_with_transport(handler).post(url, json=json, timeout=timeout))

        result = _call_model("http://fake-host:11434", "qwen3:14b", FIRST_CASE, timeout_s=5.0)

        assert result.ok is True
        assert result.schema_valid is True
        assert result.parsed_output == {"summary": "The site was unreachable during the audit."}
        assert result.error is None
        assert result.latency_s is not None

    def test_malformed_json_content_is_reported_as_error(self, monkeypatch):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"choices": [{"message": {"content": "not valid json"}}]})

        monkeypatch.setattr(httpx, "post", lambda url, json, timeout: _make_client_with_transport(handler).post(url, json=json, timeout=timeout))

        result = _call_model("http://fake-host:11434", "qwen3:14b", FIRST_CASE, timeout_s=5.0)

        assert result.ok is False
        assert result.schema_valid is False
        assert "JSONDecodeError" in result.error

    def test_schema_violation_is_flagged_but_not_a_request_failure(self, monkeypatch):
        def handler(request: httpx.Request) -> httpx.Response:
            content = json.dumps({"summary": "ok", "hallucinated_field": "oops"})
            return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})

        monkeypatch.setattr(httpx, "post", lambda url, json, timeout: _make_client_with_transport(handler).post(url, json=json, timeout=timeout))

        result = _call_model("http://fake-host:11434", "qwen3:14b", FIRST_CASE, timeout_s=5.0)

        assert result.ok is True
        assert result.schema_valid is False
        assert result.parsed_output is None
        assert "hallucinated_field" in result.error

    def test_connection_error_is_caught_not_raised(self, monkeypatch):
        def raise_connect_error(*args, **kwargs):
            raise httpx.ConnectError("connection refused")

        monkeypatch.setattr(httpx, "post", raise_connect_error)

        result = _call_model("http://unreachable-host:11434", "qwen3:14b", FIRST_CASE, timeout_s=5.0)

        assert result.ok is False
        assert result.schema_valid is False
        assert "ConnectError" in result.error

    def test_timeout_is_caught_and_reported(self, monkeypatch):
        def raise_timeout(*args, **kwargs):
            raise httpx.TimeoutException("timed out")

        monkeypatch.setattr(httpx, "post", raise_timeout)

        result = _call_model("http://slow-host:11434", "qwen3:14b", FIRST_CASE, timeout_s=1.0)

        assert result.ok is False
        assert "timed out" in result.error


class TestRunBenchmarkAndSummarize:
    def test_run_benchmark_covers_every_case_for_every_model(self, monkeypatch):
        def handler(request: httpx.Request) -> httpx.Response:
            body = json.loads(request.content)
            schema = body["response_format"]["json_schema"]["schema"]
            fake: dict[str, object] = {}
            for field, spec in schema.get("properties", {}).items():
                t = spec.get("type")
                if t == "string" or (isinstance(t, list) and "string" in t):
                    fake[field] = "placeholder"
                elif t == "integer":
                    fake[field] = 1
                elif t == "array":
                    fake[field] = []
                else:
                    fake[field] = None
            return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(fake)}}]})

        monkeypatch.setattr(httpx, "post", lambda url, json, timeout: _make_client_with_transport(handler).post(url, json=json, timeout=timeout))

        results = run_benchmark("http://fake-host:11434", ["model-a", "model-b"], timeout_s=5.0)

        assert len(results) == len(CASES) * 2
        assert {r.model for r in results} == {"model-a", "model-b"}
        assert {r.case_name for r in results} == {c["name"] for c in CASES}
        assert all(r.ok and r.schema_valid for r in results)

    def test_summarize_aggregates_per_model(self):
        from run_benchmark import CaseResult

        results = [
            CaseResult("model-a", "case1", True, 1.0, True, "{}", {}, None),
            CaseResult("model-a", "case2", True, 3.0, False, "{}", None, "bad"),
            CaseResult("model-b", "case1", False, None, False, None, None, "timeout"),
        ]
        summary = summarize(results)

        assert summary["model-a"]["requests_ok"] == "2/2"
        assert summary["model-a"]["schema_valid"] == "1/2"
        assert summary["model-a"]["avg_latency_s"] == 2.0
        assert summary["model-b"]["requests_ok"] == "0/1"
        assert summary["model-b"]["avg_latency_s"] is None


class TestPromptsIntegrity:
    def test_every_case_has_required_fields(self):
        for case in CASES:
            assert case["name"]
            assert case["system"]
            assert case["user"]
            assert case["json_schema"]["type"] == "object"
            assert "required" in case["json_schema"]
            assert case["notes"]

    def test_case_names_are_unique(self):
        names = [c["name"] for c in CASES]
        assert len(names) == len(set(names))

    def test_eight_cases_present(self):
        assert len(CASES) == 8
