# Worldlayer script LLM

Worldlayer uses an LLM only after research has been explicitly approved. The LLM writes narration sections from verified or observed approved claims. Research, claim verification, editorial planning, narration audio, and rendering remain separate stages. The template script provider remains the offline default.

## Local setup

Set `OPENROUTER_API_KEY` in the process environment or the project's ignored `.env` file. Never place it in a brief, research packet, or script artifact. `WORLDLAYER_LLM_MODEL` optionally selects the model. The default development model is `nex-agi/nex-n2.5-mini:free`, an explicit free model ID confirmed by a small live Phase 11.1 request. You can override it with `--model <provider/model:free>`. Phase 11.1 rejects paid model IDs and does not configure model fallbacks. `openrouter/free` is available only when selected explicitly; it routes dynamically, and the resulting script records the actual model returned by OpenRouter.

Fixture development example:

```powershell
npm run worldlayer:content -- public/content/toronto-brief.json /content/toronto-research-fixture.json --approved-fixture --script-provider openrouter --model nex-agi/nex-n2.5-mini:free
```

For live web research, use the existing `--approve-research <artifact> --digest <digest>` pair before selecting `--script-provider openrouter`. Newly gathered research still stops at approval. The content command writes `renders/scripts/<slug>-script.json` and `renders/scripts/<slug>-narration.txt`, then passes the script to the existing editorial planner. Add `--render` only after reviewing the generated script and prepared job.

The prompt is versioned and sends compact approved claims with claim and source IDs, not full source pages. Long claim sets are split into ordered batches. The model must return JSON sections with claim IDs. Worldlayer rejects malformed JSON, unknown or unusable IDs, changed claim order, unsupported numeric details, and truncated responses. A model can still paraphrase a claim incorrectly; review generated prose against the claim ledger before production.

Before a request, Worldlayer logs the selected model, free status, and input character count. The artifact records provider, requested and resolved models, prompt version, generation time, request count, and usage when available. It contains no credential or sensitive headers. Authentication, invalid model, and exhausted quota errors fail directly. Temporary rate limits, network errors, and server failures receive at most two retries. There is no automatic paid fallback.

OpenRouter here is a **text LLM gateway**. The separate narration providers remain mock and OpenAI TTS; selecting OpenRouter for script writing does not change TTS or audio assembly.

OpenRouter's [chat completion API](https://openrouter.ai/docs/quickstart) accepts explicit model IDs. Its [free model catalog](https://openrouter.ai/collections/free-models/) changes over time; verify a chosen free model before a live run. The optional [free router](https://openrouter.ai/openrouter/free) chooses a model dynamically.
