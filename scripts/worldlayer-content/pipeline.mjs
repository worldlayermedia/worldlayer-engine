import fs from 'node:fs';
import path from 'node:path';
import {
  validateTopicBrief,
  validateClaimLedger,
  validateResearchPacket,
} from './schema.mjs';
import {
  researchTopic,
  approveDevelopmentFixture,
  approveWebResearch,
  generateScript,
} from './providers.mjs';
import {
  createScenePlan,
  videoJobFromScenePlan,
} from '../worldlayer-editorial/scene-plan.mjs';

function outputDirectory(root, name) {
  const base = fs.realpathSync(root);
  const directory = path.join(base, name);
  fs.mkdirSync(directory, { recursive: true });
  if (path.relative(base, fs.realpathSync(directory)) !== name)
    throw new Error(`Worldlayer: ${name} output escapes renders.`);
  return directory;
}

function writeArtifact(directory, name, content) {
  const file = path.join(directory, name);
  if (fs.existsSync(file) && !fs.lstatSync(file).isFile())
    throw new Error(`Worldlayer: artifact ${name} must be a regular file.`);
  fs.writeFileSync(file, content);
  return file;
}

export function contentSlug(title) {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  if (!slug)
    throw new Error('Worldlayer: title needs characters for an artifact slug.');
  return slug.slice(0, 80);
}

export async function prepareContent({
  brief,
  fixture,
  outputRoot,
  approvedFixture = false,
  scriptProvider = 'template',
  model,
  scriptOptions,
}) {
  validateTopicBrief(brief);
  const slug = contentSlug(brief.title);
  const researchDirectory = outputDirectory(outputRoot, 'research');
  const packet = await researchTopic({
    brief,
    provider: 'fixture',
    options: { fixture },
  });
  let activePacket = packet;
  const researchPath = writeArtifact(
    researchDirectory,
    `${slug}-research.json`,
    `${JSON.stringify(packet, null, 2)}\n`,
  );
  if (!approvedFixture)
    return { status: 'awaiting_approval', packet, researchPath };
  activePacket = approveDevelopmentFixture(packet, {
    explicitFixtureApproval: true,
  });
  writeArtifact(
    researchDirectory,
    `${slug}-research.json`,
    `${JSON.stringify(activePacket, null, 2)}\n`,
  );
  return prepareApprovedContent({
    brief,
    packet: activePacket,
    outputRoot,
    researchPath,
    scriptProvider,
    model,
    scriptOptions,
  });
}

function writeLedger(packet, researchDirectory, slug) {
  const ledger = validateClaimLedger(
    {
      version: '0.1',
      topic: packet.topic,
      claims: packet.claims,
    },
    packet,
  );
  const claimsPath = writeArtifact(
    researchDirectory,
    `${slug}-claims.json`,
    `${JSON.stringify(ledger, null, 2)}\n`,
  );
  return { ledger, claimsPath };
}

async function prepareApprovedContent({
  brief,
  packet,
  outputRoot,
  researchPath,
  existingLedger,
  scriptProvider = 'template',
  model,
  scriptOptions,
}) {
  validateTopicBrief(brief);
  validateResearchPacket(packet);
  if (packet.approval.status !== 'approved')
    throw new Error(
      'Worldlayer: research must be approved before script generation.',
    );
  const slug = `${contentSlug(brief.title)}${packet.provenance.provider === 'web' ? '-web' : ''}`;
  const researchDirectory = outputDirectory(outputRoot, 'research');
  const { ledger, claimsPath } =
    existingLedger ?? writeLedger(packet, researchDirectory, slug);
  const script = await generateScript({
    brief,
    packet,
    provider: scriptProvider,
    model,
    options: scriptOptions,
  });
  const scriptsDirectory = outputDirectory(outputRoot, 'scripts');
  const scriptPath = writeArtifact(
    scriptsDirectory,
    `${slug}-script.json`,
    `${JSON.stringify(script, null, 2)}\n`,
  );
  const narrationPath = writeArtifact(
    scriptsDirectory,
    `${slug}-narration.txt`,
    `${script.text}\n`,
  );

  const planningJob = {
    version: '0.2',
    project: 'worldlayer',
    title: brief.title,
    output: { filename: `worldlayer-${slug}`, format: 'mp4' },
    video: {
      format: 'youtube_16_9',
      resolution: { width: 1920, height: 1080 },
      fps: 24,
    },
    narration: { provider: 'mock', voice: 'default' },
    captionMode: 'script',
    planning: {
      scriptArtifact: `renders/scripts/${slug}-script.json`,
      locations: structuredClone(brief.locations),
      defaultLocation: Object.keys(brief.locations)[0],
      minimumSceneDuration: 1,
    },
  };
  const plan = createScenePlan(planningJob, script.text);
  const job = videoJobFromScenePlan(planningJob, plan, {
    narrationText: script.text,
  });
  const plansDirectory = outputDirectory(outputRoot, 'plans');
  const planPath = writeArtifact(
    plansDirectory,
    `${slug}-scene-plan.json`,
    `${JSON.stringify(plan, null, 2)}\n`,
  );
  const jobPath = writeArtifact(
    plansDirectory,
    `${slug}-video-job.json`,
    `${JSON.stringify(job, null, 2)}\n`,
  );
  return {
    status: 'prepared',
    packet,
    ledger,
    script,
    plan,
    job,
    researchPath,
    claimsPath,
    scriptPath,
    narrationPath,
    planPath,
    jobPath,
  };
}

export async function prepareWebResearch({
  brief,
  outputRoot,
  search,
  fetchPage,
  now,
  seedUrls,
}) {
  validateTopicBrief(brief);
  const packet = await researchTopic({
    brief,
    provider: 'web',
    options: { search, fetchPage, now, seedUrls },
  });
  const directory = outputDirectory(outputRoot, 'research');
  const slug = `${contentSlug(brief.title)}-web`;
  const researchPath = writeArtifact(
    directory,
    `${slug}-research.json`,
    `${JSON.stringify(packet, null, 2)}\n`,
  );
  const { ledger, claimsPath } = writeLedger(packet, directory, slug);
  return {
    status: 'awaiting_approval',
    packet,
    ledger,
    researchPath,
    claimsPath,
  };
}

export async function continueWebResearch({
  brief,
  packet,
  expectedDigest,
  outputRoot,
  researchPath,
  scriptProvider = 'template',
  model,
  scriptOptions,
}) {
  validateTopicBrief(brief);
  if (packet.topic !== brief.title)
    throw new Error(
      'Worldlayer: approved research topic does not match brief.',
    );
  const approved = approveWebResearch(packet, expectedDigest);
  const directory = outputDirectory(outputRoot, 'research');
  const slug = `${contentSlug(brief.title)}-web`;
  const expectedPath = path.join(directory, `${slug}-research.json`);
  if (path.resolve(researchPath) !== expectedPath)
    throw new Error('Worldlayer: approval artifact path does not match topic.');
  writeArtifact(
    directory,
    `${slug}-research.json`,
    `${JSON.stringify(approved, null, 2)}\n`,
  );
  return prepareApprovedContent({
    brief,
    packet: approved,
    outputRoot,
    researchPath: expectedPath,
    scriptProvider,
    model,
    scriptOptions,
  });
}
