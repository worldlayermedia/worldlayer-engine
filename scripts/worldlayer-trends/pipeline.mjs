import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateTopicBrief } from './topic-brief-validation.mjs';
import { discoverTrends } from './providers.mjs';
import { normalizeBigQueryRows } from './google-bigquery.mjs';
import { normalizeTrends, validateOptions } from './schema.mjs';
import { rankCandidates } from './relevance.mjs';

function slug(value) {
  return (
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64) || 'trend'
  );
}

export function draftTopicBrief(
  candidate,
  {
    language = 'en',
    targetDurationSeconds = 480,
    audience = 'Curious viewers interested in spatial stories',
  } = {},
) {
  if (candidate.status !== 'candidate')
    throw new Error(
      'Worldlayer: only current, eligible trend candidates can become draft briefs.',
    );
  const brief = {
    version: '0.1',
    title: candidate.topic,
    language,
    targetDurationSeconds,
    angle: `Investigate the geographic and spatial context of ${candidate.topic}.`,
    audience,
    locations: {},
    keyQuestions: [
      `What verified sources explain the geographic or spatial context of ${candidate.topic}?`,
    ],
    exclusions: ['Unverified claims and trend popularity as factual evidence'],
    requiredPoints: [],
  };
  validateTopicBrief(brief);
  return brief;
}

function directoryInside(root) {
  fs.mkdirSync(root, { recursive: true });
  const base = fs.realpathSync(root);
  const output = path.join(base, 'trends');
  fs.mkdirSync(output, { recursive: true });
  if (path.relative(base, fs.realpathSync(output)) !== 'trends')
    throw new Error('Worldlayer: trends output escapes renders.');
  return output;
}

function writeJson(directory, name, value) {
  const target = path.join(directory, name);
  if (fs.existsSync(target) && !fs.lstatSync(target).isFile())
    throw new Error(
      `Worldlayer: trend artifact ${name} must be a regular file.`,
    );
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
  return target;
}

export async function runTrendDiscovery({
  provider,
  geo = 'CA',
  window = '24h',
  maxAgeHours = 24,
  fixturePath,
  outputRoot,
  now = () => new Date(),
  exclusions,
  selectedTrendId,
  bigQueryRun,
} = {}) {
  validateOptions({ geo, window, maxAgeHours });
  if (!outputRoot)
    throw new Error('Worldlayer: trends outputRoot is required.');
  const collectedAt = now().toISOString();
  const raw = await discoverTrends({
    provider,
    geo,
    window,
    fixturePath,
    bigQueryRun,
  });
  const observations =
    provider === 'google_bigquery' ? normalizeBigQueryRows(raw, geo) : raw;
  const trends = normalizeTrends(observations, { geo, window });
  const candidates = rankCandidates(trends, {
    now: new Date(collectedAt),
    maxAgeHours,
    exclusions,
  });
  const selected = selectedTrendId
    ? candidates.find((item) => item.trendId === selectedTrendId)
    : null;
  if (selectedTrendId && (!selected || selected.status !== 'candidate'))
    throw new Error(
      'Worldlayer: selected trend is missing or ineligible for review.',
    );
  const runId = createHash('sha256')
    .update(JSON.stringify({ provider, geo, window, raw }))
    .digest('hex')
    .slice(0, 12);
  const directory = directoryInside(outputRoot);
  const rawPath = writeJson(directory, `${runId}-raw.json`, {
    version: '0.1',
    provider,
    geo,
    window,
    collectedAt,
    observations: raw,
    use: 'topic_discovery_only',
  });
  const candidatesPath = writeJson(directory, `${runId}-candidates.json`, {
    version: '0.1',
    runId,
    provider,
    geo,
    window,
    collectedAt,
    maxAgeHours,
    status: 'awaiting_human_selection',
    selectedTrendId: selected?.trendId ?? null,
    candidates,
  });
  const briefPaths = candidates
    .filter((item) => item.status === 'candidate')
    .map((item) => ({
      trendId: item.trendId,
      path: writeJson(
        directory,
        `${slug(item.topic)}-${item.trendId.slice(-6)}-topic-brief.json`,
        draftTopicBrief(item),
      ),
    }));
  return {
    status: 'awaiting_human_selection',
    runId,
    trends,
    candidates,
    selectedTrendId: selected?.trendId ?? null,
    rawPath,
    candidatesPath,
    briefPaths,
  };
}
