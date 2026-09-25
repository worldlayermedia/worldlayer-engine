import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateNarration } from '../../scripts/worldlayer-narration-providers.mjs';
import {
  splitNarration,
  joinWavChunks,
} from '../../scripts/worldlayer-providers/openai.mjs';
import { prepareNarration } from '../../scripts/worldlayer-prepare-narration.mjs';

function wav(sample = 1000) {
  const result = Buffer.alloc(46);
  result.write('RIFF', 0);
  result.writeUInt32LE(38, 4);
  result.write('WAVEfmt ', 8);
  result.writeUInt32LE(16, 16);
  result.writeUInt16LE(1, 20);
  result.writeUInt16LE(1, 22);
  result.writeUInt32LE(24000, 24);
  result.writeUInt32LE(48000, 28);
  result.writeUInt16LE(2, 32);
  result.writeUInt16LE(16, 34);
  result.write('data', 36);
  result.writeUInt32LE(2, 40);
  result.writeInt16LE(sample, 44);
  return result;
}
const response = (bytes, status = 200) => ({
  ok: status === 200,
  status,
  arrayBuffer: async () => bytes,
});
const root = () => fs.mkdtempSync(path.join(os.tmpdir(), 'worldlayer-openai-'));
const options = (fetchImpl) => ({
  env: { OPENAI_API_KEY: 'test-only' },
  fetchImpl,
  wait: async () => {},
});

test('OpenAI provider selection generates valid WAV and ordered metadata', async () => {
  const directory = root();
  const outputPath = path.join(directory, 'speech.wav');
  const requests = [];
  const result = await generateNarration({
    provider: 'openai',
    text: 'Toronto comes into view.',
    voice: 'marin',
    outputPath,
    options: options(async (_url, request) => {
      requests.push(request);
      return response(wav());
    }),
  });
  assert.equal(result.path, outputPath);
  assert.equal(result.chunkCount, 1);
  assert.equal(result.characterCount, 24);
  assert.equal(requests.length, 1);
  assert.equal(JSON.parse(requests[0].body).response_format, 'wav');
  assert.equal(JSON.parse(requests[0].body).voice, 'marin');
  assert.equal(fs.readFileSync(outputPath).toString('ascii', 0, 4), 'RIFF');
});

test('missing key, invalid voice, text, and output path fail before network', async () => {
  const directory = root();
  const base = {
    provider: 'openai',
    text: 'Hello there.',
    voice: 'marin',
    outputPath: path.join(directory, 'a.wav'),
    options: {
      env: {},
      fetchImpl: () => {
        throw new Error('network used');
      },
    },
  };
  await assert.rejects(generateNarration(base), /OPENAI_API_KEY is required/);
  await assert.rejects(
    generateNarration({ ...base, voice: 'invalid' }),
    /voice "invalid" is unsupported/,
  );
  await assert.rejects(
    generateNarration({ ...base, text: ' ' }),
    /text must be nonempty/,
  );
  await assert.rejects(
    generateNarration({ ...base, outputPath: 'relative.wav' }),
    /absolute WAV path/,
  );
});

test('long scripts split at sentence and word boundaries without truncation', () => {
  const script = Array.from(
    { length: 120 },
    (_, index) =>
      `Sentence ${index} describes a Canadian city and its streets.`,
  ).join(' ');
  const chunks = splitNarration(script, 400);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 400));
  assert.deepEqual(chunks.join(' ').split(/\s+/), script.split(/\s+/));
  assert.ok(splitNarration('longword '.repeat(100), 100).length > 1);
  assert.throws(() => splitNarration('x'.repeat(120), 100), /word longer/);
});

test('multiple WAV chunks concatenate in generation order', async () => {
  const directory = root();
  const outputPath = path.join(directory, 'ordered.wav');
  const calls = [];
  const sentences = [
    'The first camera crosses the northern shoreline and approaches the urban center slowly.',
    'The second camera follows the railway corridor toward the central station slowly.',
    'The third camera settles above the waterfront to reveal the city from above.',
  ];
  await generateNarration({
    provider: 'openai',
    text: sentences.join(' '),
    voice: 'cedar',
    outputPath,
    options: {
      ...options(async (_url, request) => {
        calls.push(JSON.parse(request.body).input);
        return response(wav(calls.length));
      }),
      maxChunkCharacters: 100,
    },
  });
  assert.deepEqual(calls, sentences);
  const joined = fs.readFileSync(outputPath);
  assert.deepEqual(
    [joined.readInt16LE(44), joined.readInt16LE(46), joined.readInt16LE(48)],
    [1, 2, 3],
  );
  assert.deepEqual(joinWavChunks([wav(1), wav(2), wav(3)]), joined);
});

test('transient rate limits retry; authentication and invalid voice do not', async () => {
  const directory = root();
  let calls = 0;
  await generateNarration({
    provider: 'openai',
    text: 'Hello.',
    voice: 'alloy',
    outputPath: path.join(directory, 'retry.wav'),
    options: options(async () => {
      calls++;
      return calls === 1 ? response(null, 429) : response(wav());
    }),
  });
  assert.equal(calls, 2);
  for (const code of ['insufficient_quota', 'credit_balance_exhausted']) {
    let quotaCalls = 0;
    await assert.rejects(
      generateNarration({
        provider: 'openai',
        text: 'Hello.',
        voice: 'alloy',
        outputPath: path.join(directory, `${code}.wav`),
        options: options(async () => {
          quotaCalls++;
          return {
            ...response(null, 429),
            json: async () => ({ error: { code } }),
          };
        }),
      }),
      /quota is exhausted/,
    );
    assert.equal(quotaCalls, 1);
  }
  for (const status of [401, 400]) {
    let attempts = 0;
    await assert.rejects(
      generateNarration({
        provider: 'openai',
        text: 'Hello.',
        voice: 'alloy',
        outputPath: path.join(directory, `${status}.wav`),
        options: options(async () => {
          attempts++;
          return response(null, status);
        }),
      }),
      /authentication failed|request or voice was rejected/,
    );
    assert.equal(attempts, 1);
  }
});

test('network and provider failures never fall back to mock tones', async () => {
  const directory = root();
  const outputPath = path.join(directory, 'failed.wav');
  let calls = 0;
  await assert.rejects(
    generateNarration({
      provider: 'openai',
      text: 'Hello.',
      voice: 'marin',
      outputPath,
      options: {
        ...options(async () => {
          calls++;
          throw new Error('offline');
        }),
        maxRetries: 1,
      },
    }),
    /network request failed/,
  );
  assert.equal(calls, 2);
  assert.equal(fs.existsSync(outputPath), false);
  await assert.rejects(
    generateNarration({
      provider: 'openai',
      text: 'Hello.',
      voice: 'marin',
      outputPath,
      options: options(async () => response(null, 503)),
    }),
    /provider request failed/,
  );
  assert.equal(fs.existsSync(outputPath), false);
});

test('empty and malformed WAV responses fail clearly', async () => {
  const directory = root();
  for (const bytes of [Buffer.alloc(0), Buffer.from('not audio')])
    await assert.rejects(
      generateNarration({
        provider: 'openai',
        text: 'Hello.',
        voice: 'marin',
        outputPath: path.join(directory, 'bad.wav'),
        options: options(async () => response(bytes)),
      }),
      /malformed WAV audio/,
    );
});

test('preparation retains provider metadata and normal job timing checks', async () => {
  const directory = root();
  const job = JSON.parse(
    fs.readFileSync(
      new URL('../../public/jobs/video-job.json', import.meta.url),
    ),
  );
  job.narration = {
    text: 'Toronto comes into view.',
    provider: 'openai',
    voice: 'marin',
  };
  const metadata = await prepareNarration(job, {
    outputDirectory: directory,
    durationProbe: async () => 1.5,
    generate: (request) =>
      generateNarration({
        ...request,
        options: options(async () => response(wav())),
      }),
  });
  assert.equal(metadata.provider, 'openai');
  assert.equal(metadata.voice, 'marin');
  assert.equal(metadata.chunkCount, 1);
  assert.equal(metadata.characterCount, 24);
  assert.equal(metadata.duration, 1.5);
});
