import { spawnSync } from 'node:child_process';

// Daily international data only. A partition filter and bounded result cap limit scan/work.
export const GOOGLE_TRENDS_SQL = `SELECT term, rank, refresh_date, country_code, region_name
FROM \`bigquery-public-data.google_trends.international_top_rising_terms\`
WHERE refresh_date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 6 DAY) AND CURRENT_DATE()
  AND country_code = @geo
QUALIFY ROW_NUMBER() OVER (PARTITION BY LOWER(term) ORDER BY refresh_date DESC, rank ASC) = 1
ORDER BY refresh_date DESC, rank ASC
LIMIT 100`;

export function bigQueryRows({ geo, window, run = spawnSync }) {
  if (window !== '7d')
    throw new Error(
      'Worldlayer: Google Trends BigQuery is daily data and supports only the 7d window.',
    );
  if (!/^[A-Z]{2}$/.test(geo))
    throw new Error(
      'Worldlayer: Google Trends BigQuery geo must be a two-letter country code.',
    );
  const flags = [
    'query',
    '--use_legacy_sql=false',
    '--format=json',
    '--maximum_bytes_billed=2000000000',
    `--parameter=geo:STRING:${geo}`,
  ];
  // Windows installs bq as bq.cmd. Pass SQL on stdin to avoid cmd quoting.
  const windows = process.platform === 'win32';
  const result = windows
    ? run('cmd.exe', ['/d', '/s', '/c', `bq.cmd ${flags.join(' ')}`], {
        encoding: 'utf8',
        timeout: 60000,
        maxBuffer: 2_000_000,
        input: GOOGLE_TRENDS_SQL,
      })
    : run('bq', [...flags, GOOGLE_TRENDS_SQL], {
        encoding: 'utf8',
        timeout: 60000,
        maxBuffer: 2_000_000,
      });
  if (result.error?.code === 'ENOENT')
    throw new Error(
      'Worldlayer: Google Trends BigQuery requires the bq CLI and configured Google Cloud access.',
    );
  if (result.error || result.status !== 0)
    throw new Error(
      `Worldlayer: Google Trends BigQuery query failed: ${result.error?.message ?? result.stderr?.trim() ?? 'unknown error'}`,
    );
  let rows;
  try {
    rows = JSON.parse(result.stdout);
  } catch {
    throw new Error(
      'Worldlayer: Google Trends BigQuery returned invalid JSON.',
    );
  }
  if (!Array.isArray(rows))
    throw new Error(
      'Worldlayer: Google Trends BigQuery returned invalid rows.',
    );
  return rows;
}

export function normalizeBigQueryRows(rows, geo) {
  return rows
    .filter((row) => row.country_code === geo && row.term && row.refresh_date)
    .map((row) => ({
      query: row.term,
      observedAt: row.refresh_date,
      provider: 'google_trends',
      source: 'google_trends',
      retrievalMode: 'bigquery_daily',
      rank:
        Number.isInteger(Number(row.rank)) && Number(row.rank) > 0
          ? Number(row.rank)
          : null,
      searchVolume: null,
      trendStatus: 'rising',
      sourceMetadata: {
        dataset:
          'bigquery-public-data.google_trends.international_top_rising_terms',
        refreshDate: row.refresh_date,
        ...(row.region_name ? { regionName: row.region_name } : {}),
      },
    }));
}
