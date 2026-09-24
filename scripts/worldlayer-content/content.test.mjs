import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  validateTopicBrief,
  validateSource,
  validateResearchPacket,
  validateScriptArtifact,
  validateClaimLedger,
  INTEGRITY_CATEGORIES,
  approvedClaims,
} from './schema.mjs';
import {
  researchTopic,
  approveDevelopmentFixture,
  generateScript,
  loadContentFixture,
} from './providers.mjs';
import { prepareContent } from './pipeline.mjs';
import { resolveVideoTimeline } from '../../src/video/timelinePlanner.js';

const brief = JSON.parse(
  fs.readFileSync(
    new URL('../../public/content/toronto-brief.json', import.meta.url),
  ),
);
const fixture = JSON.parse(
  fs.readFileSync(
    new URL(
      '../../public/content/toronto-research-fixture.json',
      import.meta.url,
    ),
  ),
);

test('topic brief validates fields and coordinates', () => {
  validateTopicBrief(brief);
  const invalid = structuredClone(brief);
  invalid.locations.toronto.latitude = 100;
  assert.throws(() => validateTopicBrief(invalid), /latitude/);
});

test('source records require exactly one reference and honest dates', () => {
  validateSource(fixture.sources[0]);
  assert.throws(
    () => validateSource({ ...fixture.sources[0], url: 'https://example.org' }),
    /exactly one/,
  );
  assert.throws(
    () =>
      validateSource({ ...fixture.sources[0], publicationDate: 'not-a-date' }),
    /publicationDate/,
  );
});

test('fixture packet validates source and claim references', () => {
  validateResearchPacket(fixture);
  const invalid = structuredClone(fixture);
  invalid.claims[0].sourceIds = ['missing'];
  assert.throws(() => validateResearchPacket(invalid), /missing source/);
});

test('claim ledger mirrors the research packet', () => {
  const ledger = {
    version: '0.1',
    topic: fixture.topic,
    claims: fixture.claims,
  };
  validateClaimLedger(ledger, fixture);
  const invalid = structuredClone(ledger);
  invalid.claims[0].text = 'A different claim';
  assert.throws(
    () => validateClaimLedger(invalid, fixture),
    /differs from research packet/,
  );
});

test('integrity vocabulary rejects invented categories', () => {
  assert.deepEqual(INTEGRITY_CATEGORIES, [
    'VERIFIED_FACT',
    'OBSERVED_DATA',
    'ESTIMATE',
    'VISUALIZATION',
    'ASSUMPTION',
    'SPECULATION',
  ]);
  const invalid = structuredClone(fixture);
  invalid.claims[0].category = 'CERTAIN';
  assert.throws(() => validateResearchPacket(invalid), /integrity category/);
});

test('fixture research is deterministic, local, and starts pending', async () => {
  const first = await researchTopic({
    brief,
    provider: 'fixture',
    options: { fixture },
  });
  const second = await researchTopic({
    brief,
    provider: 'fixture',
    options: { fixture },
  });
  assert.deepEqual(first, second);
  assert.equal(first.approval.status, 'pending');
  assert.equal(first.provenance.fixture, true);
  assert.throws(
    () =>
      loadContentFixture(
        '/content/../secret.json',
        path.dirname(
          new URL('../../public/content/toronto-brief.json', import.meta.url)
            .pathname,
        ),
      ),
    /fixture/,
  );
});

test('approval gate blocks script generation until explicitly opted in', async () => {
  const packet = await researchTopic({
    brief,
    provider: 'fixture',
    options: { fixture },
  });
  await assert.rejects(generateScript({ brief, packet }), /requires approval/);
  assert.throws(() => approveDevelopmentFixture(packet), /explicit opt-in/);
  const approved = approveDevelopmentFixture(packet, {
    explicitFixtureApproval: true,
  });
  assert.equal(approved.approval.status, 'approved');
});

test('verified factual and observed claims enter script; unresolved and estimates do not', () => {
  const approved = approveDevelopmentFixture(fixture, {
    explicitFixtureApproval: true,
  });
  const claims = approvedClaims(approved);
  assert.equal(claims.length, 9);
  assert.ok(
    claims.every(
      (claim) =>
        claim.status === 'verified' &&
        ['VERIFIED_FACT', 'OBSERVED_DATA'].includes(claim.category),
    ),
  );
  assert.ok(
    !claims.some((claim) =>
      ['claim_010', 'claim_011', 'claim_012'].includes(claim.id),
    ),
  );
});

test('template script is deterministic and every passage maps to a usable claim', async () => {
  const packet = approveDevelopmentFixture(fixture, {
    explicitFixtureApproval: true,
  });
  const first = await generateScript({ brief, packet });
  const second = await generateScript({ brief, packet });
  assert.deepEqual(first, second);
  assert.equal(first.sections.length, 9);
  assert.ok(first.sections.every((section) => section.claimIds.length > 0));
  const invalid = structuredClone(first);
  invalid.sections[0].claimIds = ['claim_010'];
  assert.throws(
    () => validateScriptArtifact(invalid, packet),
    /unusable claim/,
  );
  invalid.sections[0].claimIds = ['does_not_exist'];
  assert.throws(
    () => validateScriptArtifact(invalid, packet),
    /nonexistent or unusable/,
  );
});

test('pipeline exports narration and feeds the Phase 8 planner without copying source fixtures', async () => {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), 'worldlayer-content-test-'),
  );
  try {
    const pending = await prepareContent({
      brief,
      fixture,
      outputRoot: temporary,
    });
    assert.equal(pending.status, 'awaiting_approval');
    assert.ok(!fs.existsSync(path.join(temporary, 'scripts')));
    const result = await prepareContent({
      brief,
      fixture,
      outputRoot: temporary,
      approvedFixture: true,
    });
    assert.equal(
      fs.readFileSync(result.narrationPath, 'utf8'),
      `${result.script.text}\n`,
    );
    assert.equal(result.plan.beats.length, result.job.scenes.length);
    assert.equal(result.job.narration.text, result.script.text);
    const resolved = resolveVideoTimeline(result.job, {
      narrationDuration: 100,
      narrationText: result.script.text,
    });
    assert.ok(Math.abs(resolved.timeline.totalVisualDuration - 100) < 0.001);
    assert.ok(resolved.timeline.captions.length > 0);
  } finally {
    if (path.dirname(temporary) === os.tmpdir())
      fs.rmSync(temporary, { recursive: true, force: true });
  }
});
