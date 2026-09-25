import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateNarration as generate } from '../../scripts/worldlayer-narration-providers.mjs';
import {
  azureEndpoint,
  DEFAULT_AZURE_VOICE,
} from '../../scripts/worldlayer-providers/azure.mjs';
import { prepareNarration } from '../../scripts/worldlayer-prepare-narration.mjs';

const root = () => fs.mkdtempSync(path.join(os.tmpdir(), 'worldlayer-azure-'));
function wav(value = 1) {
  const bytes = Buffer.alloc(46);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(38, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(24000, 24);
  bytes.writeUInt32LE(48000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(2, 40);
  bytes.writeInt16LE(value, 44);
  return bytes;
}
const response = (bytes, status = 200, message = '') => ({
  ok: status === 200,
  status,
  arrayBuffer: async () => bytes,
  text: async () => message,
});
function request(overrides = {}) {
  const directory = root();
  return {
    provider: 'azure',
    text: 'Toronto comes into view.',
    outputPath: path.join(directory, 'narration.wav'),
    options: {
      env: {
        AZURE_SPEECH_KEY: 'test-only',
        AZURE_SPEECH_REGION: 'canadacentral',
      },
      fetchImpl: async () => response(wav()),
      wait: async () => {},
    },
    ...overrides,
  };
}

test('Azure registry, endpoint, default voice, SSML escaping, WAV and metadata', async () => {
  let observed;
  const input = request({ text: 'Toronto & <Canada> appears.' });
  input.options.fetchImpl = async (url, config) => {
    observed = { url, config };
    return response(wav());
  };
  const result = await generate(input);
  assert.equal(azureEndpoint('canadacentral'), observed.url);
  assert.equal(azureEndpoint('Canada Central'), observed.url);
  assert.equal(
    observed.config.headers['X-Microsoft-OutputFormat'],
    'riff-24khz-16bit-mono-pcm',
  );
  assert.match(observed.config.body, /Toronto &amp; &lt;Canada&gt; appears/);
  assert.match(observed.config.body, /en-US-JennyNeural/);
  assert.equal(result.provider, 'azure');
  assert.equal(result.voice, DEFAULT_AZURE_VOICE);
  assert.equal(result.sampleRate, 24000);
  assert.equal(result.channels, 1);
  assert.equal(result.chunkCount, 1);
  assert.equal(result.characterCount, input.text.length);
  assert.equal(result.duration, 1 / 24000);
  assert.equal(
    fs.readFileSync(input.outputPath).toString('ascii', 0, 4),
    'RIFF',
  );
});

test('configured Azure voice and region are used without changing registry contract', async () => {
  const input = request({ voice: 'en-CA-ClaraNeural' });
  input.options.env.AZURE_SPEECH_REGION = 'eastus';
  let url, body;
  input.options.fetchImpl = async (target, config) => {
    url = target;
    body = config.body;
    return response(wav());
  };
  const result = await generate(input);
  assert.equal(url, azureEndpoint('eastus'));
  assert.match(body, /xml:lang="en-CA"/);
  assert.equal(result.voice, 'en-CA-ClaraNeural');
});

test('Azure missing key, region, invalid region, and invalid voice fail before fetch', async () => {
  let calls = 0;
  const input = request();
  input.options.fetchImpl = () => {
    calls++;
    throw new Error('unexpected');
  };
  for (const [env, voice, pattern] of [
    [
      { AZURE_SPEECH_REGION: 'eastus' },
      undefined,
      /AZURE_SPEECH_KEY is required/,
    ],
    [
      { AZURE_SPEECH_KEY: 'test-only' },
      undefined,
      /AZURE_SPEECH_REGION is required/,
    ],
    [
      { AZURE_SPEECH_KEY: 'test-only', AZURE_SPEECH_REGION: 'bad.region' },
      undefined,
      /REGION is invalid/,
    ],
    [input.options.env, 'bad<voice', /valid Azure neural voice/],
  ]) {
    await assert.rejects(
      generate({ ...input, voice, options: { ...input.options, env } }),
      pattern,
    );
  }
  assert.equal(calls, 0);
});

test('Azure chunks long text in order and joins compatible WAV frames', async () => {
  const sentences = Array.from(
    { length: 6 },
    (_, i) => `Sentence ${i} describes the Toronto waterfront and city.`,
  );
  const input = request({ text: sentences.join(' ') });
  const seen = [];
  input.options.maxChunkCharacters = 100;
  input.options.fetchImpl = async (_url, config) => {
    seen.push(config.body);
    return response(wav(seen.length));
  };
  const result = await generate(input);
  assert.ok(seen.length > 1);
  assert.equal(result.chunkCount, seen.length);
  const data = fs.readFileSync(input.outputPath);
  assert.equal(data.readUInt32LE(40), seen.length * 2);
  assert.deepEqual(
    Array.from({ length: seen.length }, (_, i) => data.readInt16LE(44 + i * 2)),
    Array.from({ length: seen.length }, (_, i) => i + 1),
  );
  for (let i = 0; i < sentences.length; i++)
    assert.ok(seen.some((body) => body.includes(sentences[i])));
});

test('Azure retries transient responses and network failures only within bound', async () => {
  for (const first of [429, 503, 'network']) {
    const input = request();
    let calls = 0;
    input.options.fetchImpl = async () => {
      calls++;
      if (calls === 1) {
        if (first === 'network') throw new Error('offline');
        return response(null, first);
      }
      return response(wav());
    };
    await generate(input);
    assert.equal(calls, 2);
  }
});

test('Azure auth, invalid voice and quota errors do not retry or use mock', async () => {
  for (const [status, message, pattern] of [
    [401, '', /authentication failed/],
    [400, '', /request or voice was rejected/],
    [429, 'Quota exceeded', /quota is exhausted/],
  ]) {
    const input = request();
    let calls = 0;
    input.options.fetchImpl = async () => {
      calls++;
      return response(null, status, message);
    };
    await assert.rejects(generate(input), pattern);
    assert.equal(calls, 1);
    assert.equal(fs.existsSync(input.outputPath), false);
  }
});

test('Azure rejects empty, malformed, and incompatible audio', async () => {
  for (const bytes of [Buffer.alloc(0), Buffer.from('wrong')]) {
    const input = request();
    input.options.fetchImpl = async () => response(bytes);
    await assert.rejects(generate(input), /empty WAV|malformed WAV/);
    assert.equal(fs.existsSync(input.outputPath), false);
  }
});

test('Azure metadata survives existing prepareNarration flow', async () => {
  const directory = root();
  const job = JSON.parse(
    fs.readFileSync(
      new URL('../../public/jobs/video-job-openai-dev.json', import.meta.url),
    ),
  );
  job.narration = { text: 'Toronto comes into view.', provider: 'azure' };
  fs.mkdirSync(path.join(directory, 'audio'));
  const metadata = await prepareNarration(job, {
    outputDirectory: directory,
    durationProbe: async () => 4,
    generate: async ({ outputPath }) => {
      fs.writeFileSync(outputPath, wav());
      return {
        path: outputPath,
        voice: DEFAULT_AZURE_VOICE,
        sampleRate: 24000,
        channels: 1,
        chunkCount: 1,
        characterCount: 24,
      };
    },
  });
  assert.equal(metadata.provider, 'azure');
  assert.equal(metadata.voice, DEFAULT_AZURE_VOICE);
  assert.equal(metadata.sampleRate, 24000);
  assert.equal(metadata.channels, 1);
  assert.equal(metadata.duration, 4);
});
