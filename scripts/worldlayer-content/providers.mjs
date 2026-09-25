import fs from 'node:fs';
import path from 'node:path';
import {
  validateTopicBrief,
  validateResearchPacket,
  approvedClaims,
  validateScriptArtifact,
  researchDigest,
} from './schema.mjs';
import { researchWeb } from './web-research.mjs';
import { generateOpenRouterScript } from './openrouter-script.mjs';

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

export function loadContentFixture(reference, contentRoot) {
  if (
    !/^\/content\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/.test(reference) ||
    reference.includes('..')
  )
    throw new Error(
      'Worldlayer: research fixture must be a JSON file inside /content.',
    );
  const root = fs.realpathSync(contentRoot);
  const file = fs.realpathSync(
    path.join(root, reference.slice('/content/'.length)),
  );
  if (!inside(root, file) || !fs.statSync(file).isFile())
    throw new Error('Worldlayer: research fixture escapes /content.');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export const researchProviders = Object.freeze({
  fixture: async ({ brief, fixture }) => {
    validateTopicBrief(brief);
    const packet = structuredClone(fixture);
    if (packet.topic !== brief.title)
      throw new Error('Worldlayer: fixture topic does not match the brief.');
    packet.provenance = {
      ...packet.provenance,
      provider: 'fixture',
      fixture: true,
    };
    packet.approval = { status: 'pending' };
    return validateResearchPacket(packet);
  },
  web: researchWeb,
});

export async function researchTopic({ brief, provider, options = {} }) {
  validateTopicBrief(brief);
  if (!Object.hasOwn(researchProviders, provider))
    throw new Error(
      `Worldlayer: research provider ${provider} is unsupported.`,
    );
  return researchProviders[provider]({ brief, ...options });
}

export function approveDevelopmentFixture(
  packet,
  { explicitFixtureApproval = false } = {},
) {
  validateResearchPacket(packet);
  if (
    !explicitFixtureApproval ||
    packet.provenance.provider !== 'fixture' ||
    packet.provenance.fixture !== true
  )
    throw new Error(
      'Worldlayer: development fixture approval requires explicit opt-in.',
    );
  const approved = structuredClone(packet);
  approved.approval = {
    status: 'approved',
    scope: 'development_fixture',
    approvedBy: 'explicit_fixture_opt_in',
  };
  return validateResearchPacket(approved);
}

export function approveWebResearch(packet, expectedDigest) {
  validateResearchPacket(packet);
  if (
    packet.provenance.provider !== 'web' ||
    packet.approval.status !== 'pending' ||
    packet.researchId !== expectedDigest ||
    researchDigest(packet) !== expectedDigest
  )
    throw new Error(
      'Worldlayer: web research approval requires the exact pending artifact digest.',
    );
  const approved = structuredClone(packet);
  approved.approval = {
    status: 'approved',
    scope: 'web_research',
    approvedBy: 'explicit_digest',
    digest: expectedDigest,
  };
  return validateResearchPacket(approved);
}

export const scriptProviders = Object.freeze({
  openrouter: generateOpenRouterScript,
  template: async ({ brief, packet, claims }) => {
    const sections = claims.map((claim, index) => ({
      id: `section_${String(index + 1).padStart(2, '0')}`,
      text: claim.text,
      claimIds: [claim.id],
    }));
    return {
      version: '0.1',
      title: brief.title,
      text: sections.map((section) => section.text).join('\n\n'),
      sections,
      provenance: {
        provider: 'template',
        researchProvider: packet.provenance.provider,
      },
    };
  },
});

export async function generateScript({
  brief,
  packet,
  provider = 'template',
  model,
  options = {},
}) {
  validateTopicBrief(brief);
  if (!Object.hasOwn(scriptProviders, provider))
    throw new Error(`Worldlayer: script provider ${provider} is unsupported.`);
  const claims = approvedClaims(packet);
  if (!claims.length)
    throw new Error(
      'Worldlayer: no usable approved claims for script generation.',
    );
  const script = await scriptProviders[provider]({
    brief,
    packet,
    claims,
    model,
    options,
  });
  return validateScriptArtifact(script, packet);
}
