import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverTrends } from './providers.mjs';
import {
  bigQueryRows,
  GOOGLE_TRENDS_SQL,
  normalizeBigQueryRows,
} from './google-bigquery.mjs';
import {
  normalizeTrends,
  trendAge,
  validateOptions,
  validateTrend,
} from './schema.mjs';
import { evaluateTrend, rankCandidates } from './relevance.mjs';
import { draftTopicBrief, runTrendDiscovery } from './pipeline.mjs';
import { validateTopicBrief } from '../worldlayer-content/schema.mjs';

const fixturePath = fileURLToPath(
  new URL(
    '../../public/trends/canada-development-fixture.json',
    import.meta.url,
  ),
);
const now = () => new Date('2026-09-23T13:00:00.000Z');
const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf8')).trends;
const trends = normalizeTrends(raw, { geo: 'CA', window: '24h' });
const trend = (query) => trends.find((item) => item.query === query);

test('fixture provider and normalized record preserve honest missing fields', async () => {
  assert.equal(
    (
      await discoverTrends({
        provider: 'fixture',
        fixturePath,
        geo: 'CA',
        window: '24h',
      })
    ).length,
    24,
  );
  const item = trend('Toronto subway expansion map');
  validateTrend(item);
  assert.equal(item.geo, 'CA');
  assert.equal(item.window, '24h');
  assert.equal(item.searchVolume, null);
  assert.equal(item.sourceMetadata.provider, 'fixture');
  assert.equal(item.sourceMetadata.retrievalMode, 'fixture');
});

test('provider contract, geography, windows, and malformed observations fail clearly', async () => {
  validateOptions({ geo: 'GB', window: '48h', maxAgeHours: 24 });
  assert.throws(
    () => validateOptions({ geo: 'Canada', window: '24h', maxAgeHours: 24 }),
    /geo/,
  );
  assert.throws(
    () => validateOptions({ geo: 'US', window: '1h', maxAgeHours: 24 }),
    /window/,
  );
  assert.throws(
    () =>
      normalizeTrends([{ observedAt: now().toISOString() }], {
        geo: 'CA',
        window: '24h',
      }),
    /query/,
  );
  await assert.rejects(discoverTrends({ provider: 'unknown' }), /unsupported/);
  await assert.rejects(
    discoverTrends({
      provider: 'fixture',
      fixturePath,
      geo: 'US',
      window: '24h',
    }),
    /does not match/,
  );
  await assert.rejects(
    discoverTrends({ provider: 'google_trending_now' }),
    /no configured supported retrieval adapter/,
  );
});

test('BigQuery adapter uses a bounded daily international query and preserves dataset limits', () => {
  assert.match(GOOGLE_TRENDS_SQL, /refresh_date BETWEEN/);
  assert.match(GOOGLE_TRENDS_SQL, /country_code = @geo/);
  assert.throws(
    () => bigQueryRows({ geo: 'CA', window: '24h' }),
    /only the 7d window/,
  );
  const rows = bigQueryRows({
    geo: 'CA',
    window: '7d',
    run: (_cmd, args) => {
      assert.ok(args.includes('--parameter=geo:STRING:CA'));
      assert.ok(args.some((arg) => arg.startsWith('--maximum_bytes_billed=')));
      return {
        status: 0,
        stdout:
          '[{"term":"Canada rail route","rank":2,"refresh_date":"2026-09-22","country_code":"CA"}]',
      };
    },
  });
  const normalized = normalizeBigQueryRows(rows, 'CA');
  assert.equal(normalized[0].retrievalMode, 'bigquery_daily');
  assert.equal(normalized[0].searchVolume, null);
  assert.equal(normalized[0].observedAt, '2026-09-22');
});

test('Google provider returns raw observations through the shared contract', async () => {
  const observations = await discoverTrends({
    provider: 'google_bigquery',
    geo: 'CA',
    window: '7d',
    bigQueryRun: () => ({
      status: 0,
      stdout:
        '[{"term":"Canada rail route","rank":2,"refresh_date":"2026-09-22","country_code":"CA"}]',
    }),
  });
  const normalized = normalizeTrends(observations, { geo: 'CA', window: '7d' });
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].sourceMetadata.retrievalMode, 'bigquery_daily');
  assert.equal(normalized[0].sourceMetadata.rawProviderId, undefined);
});

test('Worldlayer category scoring is explicit and does not mutate observed trends', () => {
  const item = trend('Toronto subway expansion map');
  const before = structuredClone(item);
  const candidate = evaluateTrend(item, { now: now() });
  assert.equal(candidate.category, 'cities');
  assert.equal(candidate.worldlayerFit.urban, 1);
  assert.equal(candidate.worldlayerFit.transport, 1);
  assert.equal(candidate.worldlayerFit.spatialStory, 1);
  assert.ok(candidate.reasons.length);
  assert.deepEqual(item, before);
});

test('ranking is deterministic and represents format fit only', () => {
  const one = rankCandidates(trends, { now: now() });
  const two = rankCandidates(trends, { now: now() });
  assert.deepEqual(one, two);
  assert.ok(
    one.every(
      (item, index) => index === 0 || one[index - 1].score >= item.score,
    ),
  );
  assert.ok(one.every((item) => !Object.hasOwn(item, 'predictedViews')));
});

test('exclusions are configurable and political topics receive review flags', () => {
  const gossip = trend('Celebrity dating rumor');
  assert.equal(evaluateTrend(gossip, { now: now() }).status, 'excluded');
  assert.notEqual(
    evaluateTrend(gossip, { now: now(), exclusions: {} }).status,
    'excluded',
  );
  const election = evaluateTrend(trend('Canada election map'), { now: now() });
  assert.equal(election.requiresEnhancedReview, true);
  assert.equal(election.status, 'candidate');
  assert.deepEqual(election.excludedBy, []);
});

test('staleness is explicit and stale observations never become draft briefs', () => {
  assert.equal(trendAge(trends[0], now(), 24).stale, false);
  const stale = evaluateTrend(trends[0], {
    now: new Date('2026-09-26T13:00:00Z'),
    maxAgeHours: 24,
  });
  assert.equal(stale.status, 'stale');
  assert.throws(() => draftTopicBrief(stale), /current, eligible/);
});

test('draft topic briefs satisfy Phase 9 schema without coordinates or factual claims', () => {
  const candidate = evaluateTrend(trends[0], { now: now() });
  const brief = draftTopicBrief(candidate);
  validateTopicBrief(brief);
  assert.deepEqual(brief.locations, {});
  assert.deepEqual(brief.requiredPoints, []);
  assert.ok(!Object.hasOwn(brief, 'claims'));
});

test('pipeline writes separate raw, evaluated, and draft artifacts then stops before research', async () => {
  const outputRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'worldlayer-trends-'),
  );
  try {
    const options = {
      provider: 'fixture',
      geo: 'CA',
      window: '24h',
      maxAgeHours: 24,
      fixturePath,
      outputRoot,
      now,
    };
    const first = await runTrendDiscovery(options);
    const second = await runTrendDiscovery(options);
    assert.equal(first.status, 'awaiting_human_selection');
    assert.equal(first.runId, second.runId);
    assert.deepEqual(first.candidates, second.candidates);
    assert.ok(fs.existsSync(first.rawPath));
    assert.ok(fs.existsSync(first.candidatesPath));
    assert.ok(first.briefPaths.length >= 5);
    assert.ok(first.briefPaths.every((entry) => fs.existsSync(entry.path)));
    assert.ok(!fs.existsSync(path.join(outputRoot, 'research')));
    const selected = await runTrendDiscovery({
      ...options,
      selectedTrendId: first.briefPaths[0].trendId,
    });
    assert.equal(selected.selectedTrendId, first.briefPaths[0].trendId);
    assert.ok(!fs.existsSync(path.join(outputRoot, 'research')));
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});
