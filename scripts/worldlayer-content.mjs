#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { projectRoot } from './worldlayer-job-path.mjs';
import { loadContentFixture } from './worldlayer-content/providers.mjs';
import { prepareContent } from './worldlayer-content/pipeline.mjs';

function readBrief(argument, root) {
  const contentRoot = fs.realpathSync(root);
  const requested = path.resolve(projectRoot, argument);
  const real = fs.realpathSync(requested);
  const relative = path.relative(contentRoot, real);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    path.extname(real) !== '.json'
  )
    throw new Error(
      'Worldlayer: topic brief must be JSON inside public/content.',
    );
  return JSON.parse(fs.readFileSync(real, 'utf8'));
}

export async function main(args = process.argv.slice(2)) {
  const [briefFile, fixtureReference, ...flags] = args;
  if (
    !briefFile ||
    !fixtureReference ||
    flags.some((flag) => !['--approved-fixture', '--render'].includes(flag))
  )
    throw new Error(
      'Worldlayer: usage: worldlayer-content <brief.json> </content/fixture.json> [--approved-fixture] [--render].',
    );
  if (flags.includes('--render') && !flags.includes('--approved-fixture'))
    throw new Error(
      'Worldlayer: rendering requires explicit approved fixture state.',
    );
  const contentRoot = path.join(projectRoot, 'public', 'content');
  const brief = readBrief(briefFile, contentRoot);
  const fixture = loadContentFixture(fixtureReference, contentRoot);
  const outputRoot = path.join(projectRoot, 'renders');
  fs.mkdirSync(outputRoot, { recursive: true });
  const result = await prepareContent({
    brief,
    fixture,
    outputRoot,
    approvedFixture: flags.includes('--approved-fixture'),
  });
  console.log(`[Worldlayer] Content stage: ${result.status}`);
  console.log(`[Worldlayer] Research packet: ${result.researchPath}`);
  if (result.status !== 'prepared') return result;
  console.log(`[Worldlayer] Claim ledger: ${result.claimsPath}`);
  console.log(`[Worldlayer] Script artifact: ${result.scriptPath}`);
  console.log(`[Worldlayer] Narration text: ${result.narrationPath}`);
  console.log(
    `[Worldlayer] Scene plan: ${result.planPath} (${result.plan.beats.length} beats)`,
  );
  console.log(`[Worldlayer] Prepared video job: ${result.jobPath}`);
  if (flags.includes('--render')) {
    const relativeJob = path.relative(projectRoot, result.jobPath);
    const status = spawnSync(
      process.execPath,
      [path.join(projectRoot, 'scripts', 'worldlayer-record.mjs'), relativeJob],
      {
        cwd: projectRoot,
        stdio: 'inherit',
        env: process.env,
      },
    );
    if (status.error) throw status.error;
    if (status.status !== 0)
      throw new Error(
        `Worldlayer: render exited with status ${status.status}.`,
      );
  }
  return result;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
