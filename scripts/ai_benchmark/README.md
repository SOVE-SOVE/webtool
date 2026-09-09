# Web Design OS local-model benchmark

Standalone operator tool (not imported by the app) for choosing/validating
`AI_LOCAL_MODEL` before it's used in production. See the T2 report for
machine-capacity findings and the provisional model recommendation.

## Run it

Once an Ollama server is reachable (see `docs/` or ask -- this laptop's
8GB RAM can't host any of the T2 candidate models, so this needs to run
against a separate server):

```bash
cd apps/api && source .venv/bin/activate   # httpx already a dependency
python ../../scripts/ai_benchmark/run_benchmark.py \
    --base-url http://<ollama-host>:11434 \
    --models qwen3:14b,qwen3:30b,gpt-oss:20b \
    --output benchmark_results.json
```

This exercises all 8 representative Web Design OS tasks (website audit
narrative, lead summary, Google review summary, review theme extraction,
lead scoring, proposal offer, meeting-brief discovery, structured JSON
extraction) against each model via Ollama's OpenAI-compatible
`/v1/chat/completions` endpoint with `response_format: json_schema` --
the same integration approach the production Ollama provider (T3) uses.

It reports mechanically for free: request success, JSON-schema validity,
and latency. It cannot automatically score accuracy, hallucination, or
writing quality -- open `benchmark_results.json`'s `raw_output` per case
and score by hand using `score_rubric.md`.

## Test the harness itself

No live server needed -- `test_run_benchmark.py` mocks the HTTP layer:

```bash
cd apps/api && .venv/bin/python -m pytest ../../scripts/ai_benchmark/test_run_benchmark.py -v
```

## Files

- `prompts.py` -- the 8 benchmark cases, each with a system/user prompt
  mirroring a real agent's guardrails, a strict JSON schema, and a
  deliberate hallucination trap (a fact NOT present in the input).
- `run_benchmark.py` -- CLI harness.
- `score_rubric.md` -- human scoring guide (9 dimensions) + how to turn
  scores into a final recommendation.
- `test_run_benchmark.py` -- unit tests for the harness (mocked HTTP).
