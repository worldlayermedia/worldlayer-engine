import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateText } from '../worldlayer-llm/providers.mjs';
import {
  selectedModel,
  DEFAULT_FREE_MODEL,
} from '../worldlayer-llm/openrouter.mjs';
import { claimBatches, scriptMessages } from './script-prompt.mjs';
import { approveDevelopmentFixture, generateScript } from './providers.mjs';
import { prepareContent } from './pipeline.mjs';
import { validateScriptArtifact } from './schema.mjs';
import { resolveVideoTimeline } from '../../src/video/timelinePlanner.js';
import { main as contentMain } from '../worldlayer-content.mjs';

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
const approved = approveDevelopmentFixture(fixture, {
  explicitFixtureApproval: true,
});
const freeModel = 'nex-agi/nex-n2.5-mini:free';
const reply = (
  content,
  { status = 200, model = freeModel, code, message } = {},
) => ({
  ok: status === 200,
  status,
  json: async () =>
    status === 200
      ? {
          model,
          choices: [{ message: { content }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 12, completion_tokens: 20 },
        }
      : { error: { code, message } },
});
const llm = (fetchImpl, extra = {}) => ({
  env: { OPENROUTER_API_KEY: 'test-only' },
  fetchImpl,
  wait: async () => {},
  ...extra,
});
const goodSections = JSON.stringify({
  sections: [
    { text: 'Toronto sits beside Lake Ontario.', claimIds: ['claim_001'] },
  ],
});

test('explicit free model is required and dynamic free router is optional', () => {
  assert.equal(selectedModel(undefined, {}), DEFAULT_FREE_MODEL);
  assert.equal(selectedModel('openrouter/free', {}), 'openrouter/free');
  assert.throws(
    () => selectedModel('openai/gpt-4o', {}),
    /requires an explicit :free/,
  );
  assert.throws(
    () => selectedModel('openai/gpt-oss-20b', {}),
    /requires an explicit :free/,
  );
});

test('provider selection and normalized response retain requested and resolved models', async () => {
  let request;
  const result = await generateText({
    provider: 'openrouter',
    model: freeModel,
    messages: [{ role: 'user', content: 'Hello' }],
    options: llm(async (_url, init) => {
      request = init;
      return reply('Hello, Toronto.');
    }),
  });
  assert.equal(result.provider, 'openrouter');
  assert.equal(result.model, freeModel);
  assert.equal(result.requestedModel, freeModel);
  assert.equal(result.text, 'Hello, Toronto.');
  assert.equal(result.usage.prompt_tokens, 12);
  assert.equal(result.finishReason, 'stop');
  const body = JSON.parse(request.body);
  assert.equal(body.model, freeModel);
  assert.equal(body.provider, undefined);
  assert.equal(body.models, undefined);
  assert.equal(body.route, undefined);
  assert.equal(body.max_tokens, 1800);
});

test('missing key and invalid provider or paid model fail before network', async () => {
  await assert.rejects(
    generateText({ provider: 'unknown', messages: [] }),
    /LLM provider/,
  );
  const base = {
    provider: 'openrouter',
    model: freeModel,
    messages: [{ role: 'user', content: 'Hello' }],
  };
  await assert.rejects(
    generateText({
      ...base,
      options: {
        env: {},
        fetchImpl: () => {
          throw Error('network used');
        },
      },
    }),
    /OPENROUTER_API_KEY/,
  );
  await assert.rejects(
    generateText({
      ...base,
      model: 'openai/gpt-4o',
      options: llm(() => {
        throw Error('network used');
      }),
    }),
    /requires an explicit :free/,
  );
});

test('authentication, model unavailability and exhausted quota do not retry', async () => {
  for (const [status, code, expected] of [
    [401, null, /authentication/],
    [404, 'model_not_found', /unavailable/],
    [402, null, /quota/],
    [429, 'insufficient_quota', /quota/],
  ]) {
    let calls = 0;
    await assert.rejects(
      generateText({
        provider: 'openrouter',
        model: freeModel,
        messages: [{ role: 'user', content: 'Hello' }],
        options: llm(async () => {
          calls++;
          return reply('', { status, code });
        }),
      }),
      expected,
    );
    assert.equal(calls, 1);
  }
});

test('quota wording without a provider code is non-retryable', async () => {
  let calls = 0;
  await assert.rejects(
    generateText({
      provider: 'openrouter',
      model: freeModel,
      messages: [{ role: 'user', content: 'Hello' }],
      options: llm(async () => {
        calls++;
        return reply('', {
          status: 429,
          message: 'Free tier daily limit reached',
        });
      }),
    }),
    /quota exhausted/,
  );
  assert.equal(calls, 1);
});

test('transient rate limits and network failures retry only within the bound', async () => {
  let calls = 0;
  const result = await generateText({
    provider: 'openrouter',
    model: freeModel,
    messages: [{ role: 'user', content: 'Hello' }],
    options: llm(async () => {
      calls++;
      return calls === 1
        ? reply('', { status: 429, code: 'rate_limited' })
        : reply('Okay');
    }),
  });
  assert.equal(calls, 2);
  assert.equal(result.text, 'Okay');
  await assert.rejects(
    generateText({
      provider: 'openrouter',
      model: freeModel,
      messages: [{ role: 'user', content: 'Hello' }],
      options: llm(
        async () => {
          throw Error('offline');
        },
        { maxRetries: 1 },
      ),
    }),
    /network request failed/,
  );
});

test('malformed and empty responses and unexpected model never silently succeed', async () => {
  for (const response of [
    reply(''),
    reply('text', { model: 'paid/other' }),
    { ok: true, status: 200, json: async () => null },
  ]) {
    await assert.rejects(
      generateText({
        provider: 'openrouter',
        model: freeModel,
        messages: [{ role: 'user', content: 'Hello' }],
        options: llm(async () => response),
      }),
      /empty|malformed|differs/,
    );
  }
  const dynamic = await generateText({
    provider: 'openrouter',
    model: 'openrouter/free',
    messages: [{ role: 'user', content: 'Hello' }],
    options: llm(async () => reply('Okay', { model: 'some/actual:free' })),
  });
  assert.equal(dynamic.model, 'some/actual:free');
});

test('prompt includes only approved claims and batches preserve order without truncation', () => {
  const claims = approved.claims.filter(
    (claim) =>
      claim.status === 'verified' &&
      ['VERIFIED_FACT', 'OBSERVED_DATA'].includes(claim.category),
  );
  const batches = claimBatches(claims, 600);
  assert.ok(batches.length > 1);
  assert.deepEqual(
    batches.flat().map((claim) => claim.id),
    claims.map((claim) => claim.id),
  );
  const messages = scriptMessages({
    brief,
    claims: batches[0],
    batchIndex: 0,
    batchCount: batches.length,
  });
  assert.ok(messages[1].content.includes('claim_001'));
  assert.ok(!messages[1].content.includes('claim_010'));
});

test('OpenRouter script generation enforces approved claim references and structured sections', async () => {
  const packet = approved;
  const options = {
    llm: llm(async () => reply(goodSections)),
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  };
  const script = await generateScript({
    brief,
    packet,
    provider: 'openrouter',
    model: freeModel,
    options,
  });
  validateScriptArtifact(script, packet);
  assert.equal(script.sections[0].claimIds[0], 'claim_001');
  assert.equal(script.generation.provider, 'openrouter');
  assert.equal(script.generation.model, freeModel);
  assert.equal(script.generation.requestCount, 1);
  assert.equal(script.generation.generatedAt, '2026-01-01T00:00:00.000Z');
  for (const content of [
    'not json',
    '{}',
    JSON.stringify({ sections: [{ text: 'Wrong', claimIds: ['claim_010'] }] }),
    JSON.stringify({
      sections: [{ text: 'Toronto has 999 towers.', claimIds: ['claim_001'] }],
    }),
  ]) {
    await assert.rejects(
      generateScript({
        brief,
        packet,
        provider: 'openrouter',
        model: freeModel,
        options: { llm: llm(async () => reply(content)) },
      }),
      /JSON|sections|approved batch|numeric detail/,
    );
  }
  await assert.rejects(
    generateScript({
      brief,
      packet: fixture,
      provider: 'openrouter',
      model: freeModel,
      options,
    }),
    /approval/,
  );
});

test('fixture template remains deterministic and OpenRouter output feeds narration and planner', async () => {
  const first = await generateScript({ brief, packet: approved });
  const second = await generateScript({ brief, packet: approved });
  assert.deepEqual(first, second);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'worldlayer-llm-'));
  try {
    const result = await prepareContent({
      brief,
      fixture,
      outputRoot: directory,
      approvedFixture: true,
      scriptProvider: 'openrouter',
      model: freeModel,
      scriptOptions: { llm: llm(async () => reply(goodSections)) },
    });
    assert.equal(
      fs.readFileSync(result.narrationPath, 'utf8'),
      `${result.script.text}\n`,
    );
    assert.equal(result.plan.beats.length, result.job.scenes.length);
    const resolved = resolveVideoTimeline(result.job, {
      narrationDuration: 10,
      narrationText: result.script.text,
    });
    assert.ok(Math.abs(resolved.timeline.totalVisualDuration - 10) < 0.001);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('content CLI requires fixture approval before OpenRouter script generation', async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'worldlayer-llm-cli-'),
  );
  const argumentsBase = [
    'public/content/toronto-llm-dev-brief.json',
    '/content/toronto-llm-dev-research-fixture.json',
    '--script-provider',
    'openrouter',
    '--model',
    freeModel,
  ];
  try {
    const pending = await contentMain(argumentsBase, { outputRoot: directory });
    assert.equal(pending.status, 'awaiting_approval');
    assert.equal(fs.existsSync(path.join(directory, 'scripts')), false);
    const prepared = await contentMain(
      [...argumentsBase, '--approved-fixture'],
      {
        outputRoot: directory,
        scriptOptions: { llm: llm(async () => reply(goodSections)) },
      },
    );
    assert.equal(prepared.status, 'prepared');
    assert.equal(prepared.script.generation.provider, 'openrouter');
    assert.equal(
      fs.readFileSync(prepared.narrationPath, 'utf8'),
      `${prepared.script.text}\n`,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
