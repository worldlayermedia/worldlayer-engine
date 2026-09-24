# Worldlayer research development workflow

The research provider orchestrates five distinct stages:

1. **Discovery:** a search provider returns candidate URLs, or `--source-url` supplies them explicitly. The public DuckDuckGo HTML adapter is best-effort and may be unavailable or challenged. It does not bypass challenges. Supplied authoritative URLs are a supported discovery mode.
2. **Retrieval:** the source fetcher downloads and parses each known URL independently of discovery.
3. **Evidence extraction:** short page passages become evidence records.
4. **Claim verification:** candidate claims retain source links, dates, conflicts, and uncertainty states.
5. **Approval:** the digest-bound packet stops at `awaiting_approval` until explicitly reviewed.

No API key is required. The Toronto development pass used supplied official URLs and live page retrieval; it was not successful autonomous web search. Source discovery does not itself determine factual authority.

Research only:

```powershell
npm run worldlayer:content -- public/content/toronto-brief.json --research-provider web --source-url https://www.toronto.ca/city-government/data-research-maps/toronto-at-a-glance/
```

The command writes `renders/research/<slug>-web-research.json` and `<slug>-web-claims.json`, prints the SHA-256 research digest, and stops at `awaiting_approval`. Review the source pages, evidence, status, dates, uncertainties, and exclusions before approval. Automated classification is conservative but is not a substitute for editorial fact checking.

The packet records `discovery.mode` (`search`, `supplied_sources`, or `mixed`), individual search attempts, source-level `discovery` origins, and `run` counts and timestamp. A search failure with supplied URLs can continue. If search fails and there are no supplied URLs, research fails without using fixture data.

To continue an approved development packet, supply both its exact path and printed digest:

```powershell
npm run worldlayer:content -- public/content/toronto-brief.json --research-provider web --approve-research renders/research/<slug>-web-research.json --digest <sha256>
```

Add `--render` only when a local video render is intended. Any change to packet contents invalidates the digest and requires another review. `--approved-fixture` applies only to the separate deterministic fixture provider.
