#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runTrendDiscovery } from './worldlayer-trends/pipeline.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(
  root,
  'public',
  'trends',
  'canada-development-fixture.json',
);

export async function main(args = process.argv.slice(2), options = {}) {
  let provider = 'google_bigquery',
    geo = 'CA',
    window = '7d',
    maxAgeHours = 24;
  let selectedTrendId;
  let exclusions;
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (value === '--provider') provider = args[++index];
    else if (value === '--geo') geo = args[++index];
    else if (value === '--window') window = args[++index];
    else if (value === '--max-age-hours') maxAgeHours = Number(args[++index]);
    else if (value === '--select') selectedTrendId = args[++index];
    else if (value === '--disable-default-exclusions') exclusions = {};
    else throw new Error(`Worldlayer: unsupported trends argument ${value}.`);
  }
  const result = await runTrendDiscovery({
    provider,
    geo,
    window,
    maxAgeHours,
    fixturePath: fixture,
    outputRoot: path.join(root, 'renders'),
    selectedTrendId,
    exclusions,
    ...options,
  });
  console.log(`[Worldlayer] Trend discovery: ${result.status}`);
  console.log(`[Worldlayer] Raw trends: ${result.rawPath}`);
  console.log(`[Worldlayer] Candidates: ${result.candidatesPath}`);
  console.log(`[Worldlayer] Draft briefs: ${result.briefPaths.length}`);
  return result;
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? '')).href)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
