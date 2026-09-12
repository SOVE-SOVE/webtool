"""
Unit tests for the individual AI providers (T3) — AnthropicProvider is
the moved implementation previously inline in app/integrations/llm.py;
OllamaProvider is new. Neither is called by any existing agent yet (see
app.integrations.ai.router and the T1/T3 reports); these tests mock the
HTTP/SDK layer directly, no live server or network access required.
"""

import json

import anthropic
import httpx
import pytest

from app.core.settings import settings
from app.integrations.ai.errors import AIProviderError, AIProviderUnavailableError
from app.integrations.ai.providers.anthropic_provider import AnthropicProvider
from app.integrations.ai.providers.ollama_provider import OllamaProvider

SCHEMA = {"type": "object", "properties": {"summary": {"type": "string"}}, "required": ["summary"]}


# --- AnthropicProvider --------------------------------------------------


class _FakeBlock:
    def __init__(self, type_, name=None, input_=None):
        self.type = type_
        self.name = name
        self.input = input_


class _FakeAnthropicResponse:
    def __init__(self, content):
        self.content = content


class _FakeMessages:
    def __init__(self, response=None, exception=None):
        self.response = response
        self.exception = exception
        self.last_kwargs = None

    def create(self, **kwargs):
        self.last_kwargs = kwargs
        if self.exception:
            raise self.exception
        return self.response


class _FakeAnthropicClient:
    def __init__(self, messages):
        self.messages = messages


class TestAnthropicProvider:
    def test_missing_api_key_raises(self, monkeypatch):
        monkeypatch.setattr(settings, "llm_api_key", "")
        provider = AnthropicProvider()

        with pytest.raises(AIProviderError, match="LLM_API_KEY"):
            provider.generate_structured(system="sys", user="usr", schema=SCHEMA, model="claude-sonnet-5")

    def test_successful_tool_call_returns_input(self, monkeypatch):
        monkeypatch.setattr(settings, "llm_api_key", "sk-ant-test-key")
        fake_messages = _FakeMessages(
            response=_FakeAnthropicResponse(
                [_FakeBlock("tool_use", name="emit_result", input_={"summary": "hello"})]
            )
        )
        monkeypatch.setattr(anthropic, "Anthropic", lambda api_key: _FakeAnthropicClient(fake_messages))

        provider = AnthropicProvider()
        result = provider.generate_structured(system="sys", user="usr", schema=SCHEMA, model="claude-sonnet-5")

        assert result.data == {"summary": "hello"}
        assert fake_messages.last_kwargs["model"] == "claude-sonnet-5"
        assert fake_messages.last_kwargs["tool_choice"] == {"type": "tool", "name": "emit_result"}

    def test_reports_token_usage_when_present(self, monkeypatch):
        monkeypatch.setattr(settings, "llm_api_key", "sk-ant-test-key")

        class _Usage:
            input_tokens = 1234
            output_tokens = 56

        response = _FakeAnthropicResponse([_FakeBlock("tool_use", name="emit_result", input_={"summary": "x"})])
        response.usage = _Usage()
        fake_messages = _FakeMessages(response=response)
        monkeypatch.setattr(anthropic, "Anthropic", lambda api_key: _FakeAnthropicClient(fake_messages))

        result = AnthropicProvider().generate_structured(system="s", user="u", schema=SCHEMA, model="claude-sonnet-5")

        assert result.input_tokens == 1234
        assert result.output_tokens == 56

    def test_api_status_error_raises_provider_error(self, monkeypatch):
        monkeypatch.setattr(settings, "llm_api_key", "sk-ant-test-key")
        request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
        response = httpx.Response(500, request=request)
        exc = anthropic.APIStatusError("server error", response=response, body=None)
        fake_messages = _FakeMessages(exception=exc)
        monkeypatch.setattr(anthropic, "Anthropic", lambda api_key: _FakeAnthropicClient(fake_messages))

        provider = AnthropicProvider()
        with pytest.raises(AIProviderError, match="500"):
            provider.generate_structured(system="sys", user="usr", schema=SCHEMA, model="claude-sonnet-5")

    def test_connection_error_raises_provider_error(self, monkeypatch):
        monkeypatch.setattr(settings, "llm_api_key", "sk-ant-test-key")
        request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
        exc = anthropic.APIConnectionError(request=request)
        fake_messages = _FakeMessages(exception=exc)
        monkeypatch.setattr(anthropic, "Anthropic", lambda api_key: _FakeAnthropicClient(fake_messages))

        provider = AnthropicProvider()
        with pytest.raises(AIProviderError):
            provider.generate_structured(system="sys", user="usr", schema=SCHEMA, model="claude-sonnet-5")

    def test_no_tool_use_block_raises_provider_error(self, monkeypatch):
        monkeypatch.setattr(settings, "llm_api_key", "sk-ant-test-key")
        fake_messages = _FakeMessages(response=_FakeAnthropicResponse([_FakeBlock("text")]))
        monkeypatch.setattr(anthropic, "Anthropic", lambda api_key: _FakeAnthropicClient(fake_messages))

        provider = AnthropicProvider()
        with pytest.raises(AIProviderError, match="unusable response"):
            provider.generate_structured(system="sys", user="usr", schema=SCHEMA, model="claude-sonnet-5")

    def test_api_key_never_appears_in_a_raised_error_message(self, monkeypatch):
        secret = "sk-ant-do-not-leak-me"
        monkeypatch.setattr(settings, "llm_api_key", secret)
        request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
        response = httpx.Response(401, request=request)
        exc = anthropic.APIStatusError("unauthorized", response=response, body=None)
        fake_messages = _FakeMessages(exception=exc)
        monkeypatch.setattr(anthropic, "Anthropic", lambda api_key: _FakeAnthropicClient(fake_messages))

        provider = AnthropicProvider()
        with pytest.raises(AIProviderError) as exc_info:
            provider.generate_structured(system="sys", user="usr", schema=SCHEMA, model="claude-sonnet-5")

        assert secret not in str(exc_info.value)


# --- OllamaProvider -------------------------------------------------------


def _mock_transport(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


class TestOllamaProvider:
    def test_successful_call_parses_json_content(self, monkeypatch):
        def handler(request: httpx.Request) -> httpx.Response:
            body = json.loads(request.content)
            assert body["model"] == "qwen3:30b-a3b"
            assert body["response_format"]["json_schema"]["schema"] == SCHEMA
            content = json.dumps({"summary": "local model output"})
            return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})

        monkeypatch.setattr(
            httpx, "post", lambda url, json, timeout: _mock_transport(handler).post(url, json=json, timeout=timeout)
        )

        provider = OllamaProvider(base_url="http://fake-ollama:11434", timeout_seconds=5.0)
        result = provider.generate_structured(system="sys", user="usr", schema=SCHEMA, model="qwen3:30b-a3b")

        assert result.data == {"summary": "local model output"}

    def test_reports_token_usage_when_the_server_includes_it(self, monkeypatch):
        def handler(request: httpx.Request) -> httpx.Response:
            content = json.dumps({"summary": "ok"})
            return httpx.Response(
                200,
                json={
                    "choices": [{"message": {"content": content}}],
                    "usage": {"prompt_tokens": 812, "completion_tokens": 40},
                },
            )

        monkeypatch.setattr(
            httpx, "post", lambda url, json, timeout: _mock_transport(handler).post(url, json=json, timeout=timeout)
        )

        result = OllamaProvider(base_url="http://fake-ollama:11434", timeout_seconds=5.0).generate_structured(
            system="s", user="u", schema=SCHEMA, model="qwen3:30b-a3b"
        )

        assert result.input_tokens == 812
        assert result.output_tokens == 40

    def test_missing_usage_block_leaves_token_counts_none(self, monkeypatch):
        def handler(request: httpx.Request) -> httpx.Response:
            content = json.dumps({"summary": "ok"})
            return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})

        monkeypatch.setattr(
            httpx, "post", lambda url, json, timeout: _mock_transport(handler).post(url, json=json, timeout=timeout)
        )

        result = OllamaProvider(base_url="http://fake-ollama:11434", timeout_seconds=5.0).generate_structured(
            system="s", user="u", schema=SCHEMA, model="qwen3:30b-a3b"
        )

        assert result.input_tokens is None
        assert result.output_tokens is None

    def test_timeout_raises_unavailable_error(self, monkeypatch):
        def raise_timeout(*args, **kwargs):
            raise httpx.TimeoutException("timed out")

        monkeypatch.setattr(httpx, "post", raise_timeout)

        provider = OllamaProvider(base_url="http://fake-ollama:11434", timeout_seconds=1.0)
        with pytest.raises(AIProviderUnavailableError, match="timed out"):
            provider.generate_structured(system="sys", user="usr", schema=SCHEMA, model="qwen3:30b-a3b")

    def test_connection_error_raises_unavailable_error(self, monkeypatch):
        def raise_connect_error(*args, **kwargs):
            raise httpx.ConnectError("connection refused")

        monkeypatch.setattr(httpx, "post", raise_connect_error)

        provider = OllamaProvider(base_url="http://unreachable-host:11434", timeout_seconds=5.0)
        with pytest.raises(AIProviderUnavailableError, match="Make sure Ollama is running"):
            provider.generate_structured(system="sys", user="usr", schema=SCHEMA, model="qwen3:30b-a3b")

    def test_missing_model_raises_a_distinct_actionable_error(self, monkeypatch):
        from app.integrations.ai.errors import AIProviderModelMissingError

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(404, json={"error": {"message": 'model "gpt-oss:20b" not found, try pulling it first'}})

        monkeypatch.setattr(
            httpx, "post", lambda url, json, timeout: _mock_transport(handler).post(url, json=json, timeout=timeout)
        )

        provider = OllamaProvider(base_url="http://fake-ollama:11434", timeout_seconds=5.0)
        with pytest.raises(AIProviderModelMissingError, match=r"not installed.*ollama pull gpt-oss:20b"):
            provider.generate_structured(system="s", user="u", schema=SCHEMA, model="gpt-oss:20b")

    def test_non_2xx_status_raises_unavailable_error(self, monkeypatch):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(500, json={"error": "internal error"})

        monkeypatch.setattr(
            httpx, "post", lambda url, json, timeout: _mock_transport(handler).post(url, json=json, timeout=timeout)
        )

        provider = OllamaProvider(base_url="http://fake-ollama:11434", timeout_seconds=5.0)
        with pytest.raises(AIProviderUnavailableError):
            provider.generate_structured(system="sys", user="usr", schema=SCHEMA, model="qwen3:30b-a3b")

    def test_malformed_content_raises_unavailable_error(self, monkeypatch):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"choices": [{"message": {"content": "not json"}}]})

        monkeypatch.setattr(
            httpx, "post", lambda url, json, timeout: _mock_transport(handler).post(url, json=json, timeout=timeout)
        )

        provider = OllamaProvider(base_url="http://fake-ollama:11434", timeout_seconds=5.0)
        with pytest.raises(AIProviderUnavailableError, match="couldn't be used"):
            provider.generate_structured(system="sys", user="usr", schema=SCHEMA, model="qwen3:30b-a3b")

    def test_base_url_is_stripped_of_trailing_slash(self, monkeypatch):
        seen_urls = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen_urls.append(str(request.url))
            content = json.dumps({"summary": "ok"})
            return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})

        monkeypatch.setattr(
            httpx, "post", lambda url, json, timeout: _mock_transport(handler).post(url, json=json, timeout=timeout)
        )

        provider = OllamaProvider(base_url="http://fake-ollama:11434/", timeout_seconds=5.0)
        provider.generate_structured(system="sys", user="usr", schema=SCHEMA, model="qwen3:30b-a3b")

        assert seen_urls == ["http://fake-ollama:11434/v1/chat/completions"]
