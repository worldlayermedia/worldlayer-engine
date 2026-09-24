import { createHash } from 'node:crypto';

export const WINDOWS = Object.freeze(['4h', '24h', '48h', '7d']);
export const CATEGORIES = Object.freeze([
  'geography',
  'cities',
  'infrastructure',
  'aviation',
  'transportation',
  'science',
  'natural_phenomena',
  'megaprojects',
  'trade_and_logistics',
  'other',
]);

function fail(message) {
  throw new Error(`Worldlayer: trend ${message}`);
}
function text(value, field) {
  if (typeof value !== 'string' || !value.trim())
    fail(`${field} must be nonempty text.`);
}

export function validateOptions(options) {
  if (!options || typeof options !== 'object')
    fail('options must be an object.');
  if (!/^[A-Z]{2}$/.test(options.geo ?? ''))
    fail('geo must be a two-letter country code.');
  if (!WINDOWS.includes(options.window)) fail('window is unsupported.');
  if (!Number.isFinite(options.maxAgeHours) || options.maxAgeHours <= 0)
    fail('maxAgeHours must be positive.');
  return options;
}

export function validateTrend(trend) {
  if (!trend || typeof trend !== 'object') fail('record must be an object.');
  for (const field of ['id', 'query', 'geo', 'source', 'window', 'observedAt'])
    text(trend[field], field);
  if (
    !/^[A-Z]{2}$/.test(trend.geo) ||
    !WINDOWS.includes(trend.window) ||
    Number.isNaN(Date.parse(trend.observedAt))
  )
    fail('record geography, window, or observedAt is invalid.');
  if (trend.rank !== null && (!Number.isInteger(trend.rank) || trend.rank < 1))
    fail('rank must be null or a positive integer.');
  if (
    trend.searchVolume !== null &&
    (!Number.isFinite(trend.searchVolume) || trend.searchVolume < 0)
  )
    fail('searchVolume must be null or nonnegative.');
  if (!['rising', 'active', 'lasted', 'unknown'].includes(trend.trendStatus))
    fail('status is unsupported.');
  if (
    !Array.isArray(trend.relatedQueries) ||
    trend.relatedQueries.some((item) => typeof item !== 'string')
  )
    fail('relatedQueries must be strings.');
  if (
    !trend.sourceMetadata ||
    typeof trend.sourceMetadata !== 'object' ||
    Array.isArray(trend.sourceMetadata)
  )
    fail('sourceMetadata must be an object.');
  text(trend.sourceMetadata.provider, 'provenance provider');
  text(trend.sourceMetadata.retrievalMode, 'provenance retrievalMode');
  return trend;
}

export function normalizeTrends(raw, { geo, window }) {
  if (!Array.isArray(raw)) fail('provider must return an array.');
  const seen = new Set();
  return raw.map((item) => {
    if (!item || typeof item !== 'object')
      fail('provider observation must be an object.');
    text(item.query, 'query');
    text(item.observedAt, 'observedAt');
    const provider = item.provider ?? 'fixture';
    const query = item.query.trim().replace(/\s+/g, ' ');
    const id = createHash('sha256')
      .update(
        JSON.stringify([
          provider,
          geo,
          window,
          item.rawProviderId ?? query.toLowerCase(),
          item.observedAt,
        ]),
      )
      .digest('hex')
      .slice(0, 16);
    const trend = {
      id: `trend_${id}`,
      query,
      geo,
      source: item.source ?? provider,
      window,
      observedAt: item.observedAt,
      rank: item.rank ?? null,
      searchVolume: item.searchVolume ?? null,
      trendStatus: item.trendStatus ?? 'unknown',
      relatedQueries: item.relatedQueries ?? [],
      sourceMetadata: {
        ...(item.sourceMetadata ?? {}),
        provider,
        retrievalMode: item.retrievalMode ?? 'fixture',
        ...(item.rawProviderId ? { rawProviderId: item.rawProviderId } : {}),
      },
    };
    validateTrend(trend);
    if (seen.has(trend.id)) fail(`duplicate record ${trend.id}.`);
    seen.add(trend.id);
    return trend;
  });
}

export function trendAge(trend, now, maxAgeHours) {
  const ageHours = (now.getTime() - Date.parse(trend.observedAt)) / 3_600_000;
  return { ageHours, stale: ageHours < 0 || ageHours > maxAgeHours };
}
