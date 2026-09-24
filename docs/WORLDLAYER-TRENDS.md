# Worldlayer trend discovery

Trend observations answer **what Worldlayer might investigate**. They are never factual evidence for a script. The pipeline stops after draft topic briefs and waits for human selection. The separate research provider later retrieves sources and verifies claims.

## Providers and commands

`fixture` reads 24 synthetic Canada-oriented observations from `public/trends/canada-development-fixture.json`. It is development data, not live Google Trends data.

```powershell
npm run worldlayer:trends -- --provider fixture --geo CA --window 24h
```

`google_bigquery` reads Google's daily international _top rising terms_ public dataset through the `bq` CLI. It supports only `7d` because the dataset is daily, not real-time Trending Now data. Its `observedAt` is a date, with no invented time of day. Install/configure the Google Cloud CLI and BigQuery access separately; use a project or BigQuery sandbox with public-dataset access. Credentials stay in the Google Cloud environment, never in job files or source control. The query binds the ISO country code, filters `refresh_date` to seven days, deduplicates terms across regions/days, caps results at 100, and sets a 2 GB billed-bytes ceiling. Dataset coverage may vary by country and date.

```powershell
npm run worldlayer:trends -- --provider google_bigquery --geo CA --window 7d
```

Google's interactive Trending Now page is **not** scraped or automated. `google_trending_now` is an adapter boundary that fails clearly until a supported retrieval method is configured. No challenge bypass is attempted. The default CLI selects `google_bigquery` with its supported `7d` window. Other ISO geographies such as `US`, `GB`, and `AU` can be requested; dataset coverage is not guaranteed.

## Evaluation and review

Raw provider observations are normalized and written separately from candidate evaluations. Candidate scores measure Worldlayer format fit from explicit geographic, visual, infrastructure, aviation, transport, urban, science/nature, spatial-story, shelf-life, and available momentum signals. They do not predict views, revenue, or virality. Configured exclusions flag celebrity gossip, sports scores, entertainment-only, shopping, and highly local incidents. `--disable-default-exclusions` turns these defaults off. Political and geopolitical subjects stay eligible but receive `requiresEnhancedReview`.

The default freshness limit is 24 hours (`--max-age-hours` changes it). Stale records are marked `stale` and produce no draft brief. BigQuery's daily timestamp can exceed that limit; raise it deliberately for daily data, for example `--max-age-hours 48`.

Artifacts go to `renders/trends/`: `<run-id>-raw.json`, `<run-id>-candidates.json`, and one `<slug>-topic-brief.json` for each current candidate. Briefs satisfy the existing content brief schema, contain no factual claims, and have empty `locations` unless future trusted metadata supplies coordinates. `--select <trendId>` records an explicit candidate selection for review; it does **not** start factual research, script generation, or rendering.
