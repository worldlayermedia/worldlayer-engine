#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { projectRoot } from './worldlayer-job-path.mjs';
import { loadContentFixture } from './worldlayer-content/providers.mjs';
import { prepareContent } from './worldlayer-content/pipeline.mjs';
import {
  prepareWebResearch,
  continueWebResearch,
} from './worldlayer-content/pipeline.mjs';

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

function approvedArtifact(argument, outputRoot) {
  const directory = fs.realpathSync(path.join(outputRoot, 'research'));
  const requested = path.resolve(projectRoot, argument);
  const real = fs.realpathSync(requested);
  const relative = path.relative(directory, real);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    !relative.endsWith('-research.json')
  )
    throw new Error(
      'Worldlayer: approval artifact must be a research JSON file inside renders/research.',
    );
  return { path: real, packet: JSON.parse(fs.readFileSync(real, 'utf8')) };
}

export async function main(
  args = process.argv.slice(2),
  {
    outputRoot = path.join(projectRoot, 'renders'),
    search,
    fetchPage,
    now,
    scriptOptions,
  } = {},
) {
  const [briefFile, ...rest] = args;
  if (!briefFile)
    throw new Error('Worldlayer: content command requires a topic brief.');
  let fixtureReference;
  let provider = 'fixture';
  let approvalFile;
  let digest;
  let approvedFixture = false;
  let render = false;
  let scriptProvider = 'template';
  let model;
  const seedUrls = [];
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    if (arg === '--research-provider') provider = rest[++index];
    else if (arg === '--approve-research') approvalFile = rest[++index];
    else if (arg === '--digest') digest = rest[++index];
    else if (arg === '--approved-fixture') approvedFixture = true;
    else if (arg === '--render') render = true;
    else if (arg === '--script-provider') scriptProvider = rest[++index];
    else if (arg === '--model') model = rest[++index];
    else if (arg === '--source-url') seedUrls.push(rest[++index]);
    else if (!arg.startsWith('-') && !fixtureReference) fixtureReference = arg;
    else throw new Error(`Worldlayer: unsupported content argument ${arg}.`);
  }
  if (!['fixture', 'web'].includes(provider))
    throw new Error(
      `Worldlayer: research provider ${provider} is unsupported.`,
    );
  if (!['template', 'openrouter'].includes(scriptProvider))
    throw new Error(
      `Worldlayer: script provider ${scriptProvider} is unsupported.`,
    );
  if (model && scriptProvider !== 'openrouter')
    throw new Error(
      'Worldlayer: --model requires --script-provider openrouter.',
    );
  if (render && provider === 'web' && !approvalFile)
    throw new Error(
      'Worldlayer: live research must be approved before rendering.',
    );
  if (
    provider === 'fixture' &&
    (!fixtureReference || approvalFile || digest || seedUrls.length)
  )
    throw new Error(
      'Worldlayer: fixture research needs a /content fixture path.',
    );
  if (
    provider === 'web' &&
    (fixtureReference ||
      approvedFixture ||
      Boolean(approvalFile) !== Boolean(digest))
  )
    throw new Error(
      'Worldlayer: web research needs --approve-research and --digest together, or neither.',
    );
  if (render && provider === 'fixture' && !approvedFixture)
    throw new Error(
      'Worldlayer: rendering requires explicit approved fixture state.',
    );
  const contentRoot = path.join(projectRoot, 'public', 'content');
  const brief = readBrief(briefFile, contentRoot);
  fs.mkdirSync(outputRoot, { recursive: true });
  let result;
  if (provider === 'web' && !approvalFile) {
    result = await prepareWebResearch({
      brief,
      outputRoot,
      search,
      fetchPage,
      now,
      seedUrls,
    });
  } else if (provider === 'web') {
    const artifact = approvedArtifact(approvalFile, outputRoot);
    result = await continueWebResearch({
      brief,
      packet: artifact.packet,
      expectedDigest: digest,
      outputRoot,
      researchPath: artifact.path,
      scriptProvider,
      model,
      scriptOptions,
    });
  } else {
    const fixture = loadContentFixture(fixtureReference, contentRoot);
    result = await prepareContent({
      brief,
      fixture,
      outputRoot,
      approvedFixture,
      scriptProvider,
      model,
      scriptOptions,
    });
  }
  console.log(`[Worldlayer] Content stage: ${result.status}`);
  console.log(`[Worldlayer] Research packet: ${result.researchPath}`);
  if (result.claimsPath)
    console.log(`[Worldlayer] Claim ledger: ${result.claimsPath}`);
  if (result.packet.researchId)
    console.log(`[Worldlayer] Research digest: ${result.packet.researchId}`);
  if (result.status !== 'prepared') return result;
  console.log(`[Worldlayer] Script artifact: ${result.scriptPath}`);
  console.log(`[Worldlayer] Narration text: ${result.narrationPath}`);
  console.log(
    `[Worldlayer] Scene plan: ${result.planPath} (${result.plan.beats.length} beats)`,
  );
  console.log(`[Worldlayer] Prepared video job: ${result.jobPath}`);
  if (render) {
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
