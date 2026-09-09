# Local model scoring rubric

Run `run_benchmark.py` against each candidate model first -- it gives you
mechanical checks for free (did the request succeed, did the JSON satisfy
the schema, latency). Everything below is the human pass on top of that,
done by reading `benchmark_results.json`'s `raw_output` for each case.

Score each model 1-10 on each dimension, across all 8 cases (average or
gut-call an overall number per dimension -- consistency matters more than
precision here per case).

| Dimension | What to look for |
|---|---|
| Accuracy | Are output claims/values actually supported by the input? Score down for outputs that misstate a given fact (e.g. wrong review count, wrong severity). |
| Reasoning | For lead_scoring / proposal_offer / meeting_brief_discovery -- is the reasoning sound and specific to the input, not generic? |
| Instruction following | Length limits (e.g. "2-4 sentences"), tone rules ("no bullet points"), explicit constraints ("never invent a rating") -- all followed? |
| Structured output | Covered mechanically by run_benchmark.py's schema_valid check -- use that number directly, but also eyeball whether required fields are populated meaningfully vs. empty/placeholder. |
| Business writing | Does the prose read like something a person would actually send/use, or does it sound stilted, robotic, or overly hedged? |
| Summarisation | For website_audit_narrative / lead_summary / google_review_summary -- does it compress the input well without dropping the load-bearing facts? |
| Hallucination resistance | **Most important dimension.** Every case has a deliberate trap (see each case's `notes` in prompts.py) -- a specific fact that is NOT in the input (a price, a phone number, a finding, a theme). Check explicitly whether the model invented it. Score 1 if it fabricated the trapped fact, 10 if it correctly said "not given"/omitted it/used null. |
| Speed | Use `avg_latency_s` / `max_latency_s` from the summary directly. |
| Resource usage | Not benchmarked live here -- score from the model's documented size/quantized RAM footprint relative to the target server's available RAM (see T2 report). |

## Producing the final recommendation

1. Fill in the table above per model.
2. Weight hallucination resistance and instruction following highest --
   these tasks write things a salesperson or the app itself acts on
   directly; a fluent but fact-inventing model is worse than a blunt,
   accurate one.
3. Speed/resource usage are tie-breakers, not primary criteria, unless a
   model doesn't fit the target server's RAM at all (disqualifying).
4. Write the recommendation as: chosen model, the 2-3 dimensions that
   decided it, and what would change the recommendation (e.g. "if the
   server has <16GB RAM, use X instead").
