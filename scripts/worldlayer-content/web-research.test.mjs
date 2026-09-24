import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../worldlayer-content.mjs';
import { researchTopic, approveWebResearch } from './providers.mjs';
import { validateResearchPacket, researchDigest } from './schema.mjs';
import { discoverSources, searchProviders } from './search-discovery.mjs';
import {
  normalizeSourceUrl,
  detectClaimConflicts,
  researchQuestions,
  researchWeb,
} from './web-research.mjs';

const brief = JSON.parse(
  fs.readFileSync(
    new URL('../../public/content/toronto-brief.json', import.meta.url),
  ),
);
const page = (sentence, date) =>
  `<html><head><title>Toronto facts</title>${date ? `<meta property="article:published_time" content="${date}">` : ''}</head><body><main><p>${sentence}</p></main></body></html>`;
const pages = new Map([
  [
    'https://toronto.ca/geo',
    page(
      'Toronto is on the northwest shore of Lake Ontario, beside a connected system of water and nearby communities.',
      '2024-02-01',
    ),
  ],
  [
    'https://statcan.gc.ca/area',
    page(
      'Toronto includes a waterfront, downtown streets, residential blocks, and many public spaces at different geographic scales.',
    ),
  ],
  [
    'https://toronto.ca/routes',
    page(
      'Toronto roads and public transit connect waterfront districts with neighborhoods across the wider region.',
    ),
  ],
]);
const search = async () =>
  [...pages.keys(), 'https://toronto.ca/geo?utm_source=test'].map((url) => ({
    title: 'Toronto facts',
    url,
  }));
const fetchPage = async (url) => {
  if (!pages.has(url)) throw new Error('unavailable');
  return { url, html: pages.get(url) };
};
const options = {
  search,
  fetchPage,
  now: () => new Date('2026-09-23T00:00:00Z'),
};

test('web provider uses validated brief and returns research packet contract', async () => {
  const packet = await researchTopic({ brief, provider: 'web', options });
  validateResearchPacket(packet);
  assert.equal(packet.approval.status, 'pending');
  assert.equal(packet.provenance.provider, 'web');
  assert.equal(
    packet.researchQuestions.length,
    researchQuestions(brief).length,
  );
  assert.equal(packet.sources.length, 3);
  assert.ok(packet.claims.length >= 3);
  assert.ok(
    packet.sources.every((source) => source.accessedDate === '2026-09-23'),
  );
});

test('source URL normalization removes tracking and duplicate sources', async () => {
  assert.equal(
    normalizeSourceUrl('http://WWW.TORONTO.CA/geo/?utm_source=x&b=2&a=1#part'),
    'https://toronto.ca/geo?a=1&b=2',
  );
  assert.throws(
    () => normalizeSourceUrl('http://127.0.0.1/private'),
    /public HTTP/,
  );
  assert.throws(
    () => normalizeSourceUrl('http://[::1]/private'),
    /public HTTP/,
  );
  assert.throws(
    () => normalizeSourceUrl('https://user:pass@example.org/private'),
    /public HTTP/,
  );
  const packet = await researchWeb({ brief, ...options });
  assert.equal(
    new Set(packet.sources.map((source) => source.url)).size,
    packet.sources.length,
  );
});

test('claims have valid evidence references and missing publication dates remain absent', async () => {
  const packet = await researchWeb({ brief, ...options });
  assert.ok(
    packet.claims.every((claim) =>
      claim.evidence.every((item) => claim.sourceIds.includes(item.sourceId)),
    ),
  );
  assert.ok(
    !Object.hasOwn(
      packet.sources.find((source) => source.url.includes('statcan')),
      'publicationDate',
    ),
  );
  const invalid = structuredClone(packet);
  delete invalid.researchId;
  invalid.claims[0].evidence[0].sourceId = 'missing';
  assert.throws(
    () => validateResearchPacket(invalid),
    /evidence references missing source/,
  );
});

test('conflicting values are retained but lose verified status', () => {
  const claims = [
    {
      id: 'claim_001',
      text: 'Toronto population in 2021 was 2,000,000.',
      status: 'verified',
    },
    {
      id: 'claim_002',
      text: 'Toronto population in 2021 was 3,000,000.',
      status: 'verified',
    },
  ];
  const issues = detectClaimConflicts(claims);
  assert.equal(issues.length, 1);
  assert.ok(claims.every((claim) => claim.status === 'partially_supported'));
});

test('conflicting land-area table and prose values stay partially supported', async () => {
  const area = new Map(pages);
  area.set(
    'https://toronto.ca/geo',
    '<html><head><title>Area</title><meta name="description" content="Indicators (2023) City Land Area (km2) 630"></head><body><main><p>Located on a broad plateau, Toronto covers 641 sq.km. beside valleys and water.</p></main></body></html>',
  );
  const packet = await researchWeb({
    brief,
    search,
    fetchPage: async (url) => ({ url, html: area.get(url) }),
    now: options.now,
  });
  assert.ok(
    packet.claims.some(
      (claim) =>
        claim.text.includes('641 sq.km') &&
        claim.status === 'partially_supported',
    ),
  );
  assert.ok(
    packet.uncertainties.some((item) => item.includes('Land-area conflict')),
  );
});

test('time-sensitive facts without a stated period remain partially supported', async () => {
  const numeric = new Map(pages);
  numeric.set(
    'https://toronto.ca/routes',
    page(
      'Toronto population is approximately 3,000,000 people according to this public information page.',
    ),
  );
  const packet = await researchWeb({
    brief,
    search,
    fetchPage: async (url) => ({ url, html: numeric.get(url) }),
    now: options.now,
  });
  assert.ok(
    packet.claims.some((claim) => claim.status === 'partially_supported'),
  );
  assert.ok(
    packet.uncertainties.some((item) => item.includes('no explicit period')),
  );
});

test('web approval binds the exact research digest and changes invalidate it', async () => {
  const packet = await researchWeb({ brief, ...options });
  assert.equal(packet.researchId, researchDigest(packet));
  assert.throws(
    () => approveWebResearch(packet, '0'.repeat(64)),
    /exact pending artifact digest/,
  );
  const approved = approveWebResearch(packet, packet.researchId);
  validateResearchPacket(approved);
  approved.claims[0].text += ' Changed';
  assert.throws(() => validateResearchPacket(approved), /digest/);
});

test('source failures are recorded while usable sources continue', async () => {
  const searchWithBad = async () => [
    { url: 'https://toronto.ca/bad', title: 'bad' },
    ...(await search()),
  ];
  const packet = await researchWeb({
    brief,
    search: searchWithBad,
    fetchPage,
    now: options.now,
  });
  assert.equal(packet.sources.length, 3);
  assert.ok(
    packet.uncertainties.some((item) => item.includes('Source unavailable')),
  );
});

test('substantially repeated direct claims share one ledger entry and both source IDs', async () => {
  const duplicate = new Map(pages);
  const shared =
    'Toronto is on the northwest shore of Lake Ontario, beside a connected system of water and nearby communities.';
  duplicate.set(
    'https://statcan.gc.ca/area',
    page(
      `${shared} Toronto includes a waterfront, downtown streets, residential blocks, and many public spaces at different geographic scales.`,
    ),
  );
  const packet = await researchWeb({
    brief,
    search,
    fetchPage: async (url) => ({ url, html: duplicate.get(url) }),
    now: options.now,
  });
  assert.equal(
    packet.claims.filter((claim) => claim.text === shared).length,
    1,
  );
  assert.equal(
    packet.claims.find((claim) => claim.text === shared).sourceIds.length,
    2,
  );
});

test('uncovered required point becomes unresolved instead of an invented fact', async () => {
  const changedBrief = {
    ...brief,
    requiredPoints: [
      ...brief.requiredPoints,
      'Untraceable demonstration point',
    ],
  };
  const packet = await researchWeb({ brief: changedBrief, ...options });
  assert.ok(
    packet.claims.some(
      (claim) =>
        claim.status === 'unresolved' &&
        claim.text === 'Untraceable demonstration point',
    ),
  );
  assert.ok(
    packet.uncertainties.some((item) =>
      item.includes('no direct page evidence'),
    ),
  );
});

test('provider failures and insufficient evidence fail clearly', async () => {
  await assert.rejects(
    researchWeb({
      brief,
      search: async () => {
        throw new Error('offline');
      },
      fetchPage,
      now: options.now,
    }),
    /insufficient discoverable evidence/,
  );
  await assert.rejects(
    researchWeb({
      brief,
      search: async () => [{ url: 'https://toronto.ca/geo' }],
      fetchPage,
      now: options.now,
    }),
    /insufficient usable web evidence/,
  );
});

test('mock discovery and supplied discovery remain separate capabilities', async () => {
  const result = await discoverSources({
    queries: ['Toronto geography'],
    searchProvider: searchProviders.mock(async () => [
      { url: 'https://toronto.ca/geo', snippet: 'shore' },
    ]),
    suppliedProvider: searchProviders.supplied(['https://statcan.gc.ca/area']),
  });
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.discovery),
    ['supplied', 'search'],
  );
  assert.equal(result.searchAttempts[0].status, 'success');
});

test('supplied sources work after search failure and record run provenance', async () => {
  const packet = await researchWeb({
    brief,
    ...options,
    search: async () => {
      throw new Error('challenged');
    },
    seedUrls: [...pages.keys()],
  });
  assert.equal(packet.discovery.mode, 'supplied_sources');
  assert.equal(packet.run.queryCount, packet.discovery.searchAttempts.length);
  assert.equal(packet.run.successfulSearchCount, 0);
  assert.equal(packet.run.failedSearchCount, packet.run.queryCount);
  assert.equal(packet.run.suppliedUrlCount, 3);
  assert.equal(packet.run.fetchedSourceCount, 3);
  assert.equal(packet.run.researchTimestamp, '2026-09-23T00:00:00.000Z');
  assert.ok(
    packet.sources.every((source) => source.discovery.includes('supplied')),
  );
});

test('mixed discovery deduplicates URLs and preserves both source origins', async () => {
  const packet = await researchWeb({
    brief,
    ...options,
    seedUrls: ['https://toronto.ca/geo?utm_source=supplied'],
  });
  assert.equal(packet.discovery.mode, 'mixed');
  assert.equal(packet.sources.length, 3);
  assert.deepEqual(
    packet.sources.find((source) => source.url === 'https://toronto.ca/geo')
      .discovery,
    ['supplied', 'search'],
  );
  assert.equal(packet.researchId, researchDigest(packet));
  assert.equal(
    packet.researchId,
    (
      await researchWeb({
        brief,
        ...options,
        seedUrls: ['https://toronto.ca/geo?utm_source=supplied'],
      })
    ).researchId,
  );
});

test('research-only CLI writes packet and ledger then stops before script generation', async () => {
  const outputRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'worldlayer-web-test-'),
  );
  try {
    const result = await main(
      ['public/content/toronto-brief.json', '--research-provider', 'web'],
      { outputRoot, ...options },
    );
    assert.equal(result.status, 'awaiting_approval');
    assert.ok(fs.existsSync(result.researchPath));
    assert.ok(fs.existsSync(result.claimsPath));
    assert.ok(!fs.existsSync(path.join(outputRoot, 'scripts')));
  } finally {
    if (path.dirname(outputRoot) === os.tmpdir())
      fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('CLI approval requires matching artifact digest before downstream preparation', async () => {
  const outputRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'worldlayer-approval-test-'),
  );
  try {
    const pending = await main(
      ['public/content/toronto-brief.json', '--research-provider', 'web'],
      { outputRoot, ...options },
    );
    await assert.rejects(
      main(
        [
          'public/content/toronto-brief.json',
          '--research-provider',
          'web',
          '--approve-research',
          pending.researchPath,
          '--digest',
          '0'.repeat(64),
        ],
        { outputRoot },
      ),
      /exact pending artifact digest/,
    );
    const prepared = await main(
      [
        'public/content/toronto-brief.json',
        '--research-provider',
        'web',
        '--approve-research',
        pending.researchPath,
        '--digest',
        pending.packet.researchId,
      ],
      { outputRoot },
    );
    assert.equal(prepared.status, 'prepared');
    assert.equal(prepared.packet.approval.digest, pending.packet.researchId);
    assert.ok(fs.existsSync(prepared.scriptPath));
  } finally {
    if (path.dirname(outputRoot) === os.tmpdir())
      fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});
