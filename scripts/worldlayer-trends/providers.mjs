import fs from 'node:fs';
import { bigQueryRows } from './google-bigquery.mjs';

export const trendProviders = Object.freeze({
  fixture: async ({ fixturePath, geo, window }) => {
    if (!fixturePath)
      throw new Error('Worldlayer: trend fixture path is required.');
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    if (
      fixture.version !== '0.1' ||
      fixture.kind !== 'development_fixture' ||
      !Array.isArray(fixture.trends)
    )
      throw new Error('Worldlayer: trend fixture is invalid.');
    if (fixture.geo !== geo || fixture.window !== window)
      throw new Error(
        'Worldlayer: trend fixture geography or window does not match the request.',
      );
    return fixture.trends;
  },
  google_bigquery: async ({ geo, window, bigQueryRun }) =>
    bigQueryRows({ geo, window, run: bigQueryRun }),
  google_trending_now: async () => {
    throw new Error(
      'Worldlayer: Google Trends Trending Now has no configured supported retrieval adapter.',
    );
  },
});

export async function discoverTrends({ provider, ...options }) {
  if (!Object.hasOwn(trendProviders, provider))
    throw new Error(`Worldlayer: trend provider ${provider} is unsupported.`);
  return trendProviders[provider](options);
}
