import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateVideoJob } from './jobValidation.js';
import { prepareNarration } from '../../scripts/worldlayer-prepare-narration.mjs';
import { generateNarration } from '../../scripts/worldlayer-narration-providers.mjs';
import { loadNarrationScript } from '../../scripts/worldlayer-script-config.mjs';

const fixture = () =>
  JSON.parse(
    fs.readFileSync(
      new URL('../../public/jobs/video-job.json', import.meta.url),
      'utf8',
    ),
  );
const temporaryRoot = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'worldlayer-narration-'));
const wavDuration = async (filePath) => {
  const wav = fs.readFileSync(filePath);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  return wav.readUInt32LE(40) / wav.readUInt32LE(28);
};

test('no narration leaves the existing silent path intact', async () => {
  assert.equal(
    await prepareNarration(fixture(), {
      durationProbe: () => {
        throw new Error('probe called');
      },
    }),
    null,
  );
});

test('prerecorded narration returns file metadata without generating output', async () => {
  const root = temporaryRoot();
  const audioRoot = path.join(root, 'audio');
  fs.mkdirSync(audioRoot);
  fs.writeFileSync(path.join(audioRoot, 'manual.wav'), 'manual recording');
  const job = fixture();
  job.audio = { narration: { file: '/audio/manual.wav' } };
  const metadata = await prepareNarration(job, {
    audioRoot,
    outputDirectory: root,
    durationProbe: async () => 7.25,
  });
  assert.equal(metadata.provider, 'file');
  assert.equal(metadata.voice, null);
  assert.equal(metadata.duration, 7.25);
  assert.equal(metadata.path, path.join(audioRoot, 'manual.wav'));
  assert.equal(fs.readFileSync(metadata.path, 'utf8'), 'manual recording');
  assert.equal(
    fs.existsSync(path.join(root, 'audio', 'worldlayer-mvp-narration.wav')),
    false,
  );
});

test('generated text narration uses mock provider and returns actual WAV metadata', async () => {
  const root = temporaryRoot();
  const job = fixture();
  job.narration = {
    text: 'One two three four',
    provider: 'mock',
    voice: 'default',
  };
  const metadata = await prepareNarration(job, {
    outputDirectory: root,
    durationProbe: wavDuration,
  });
  assert.equal(metadata.provider, 'mock');
  assert.equal(metadata.voice, 'default');
  assert.equal(metadata.duration, 1.2);
  assert.equal(
    metadata.path,
    path.join(root, 'audio', 'worldlayer-mvp-narration.wav'),
  );
  assert.equal(metadata.captionTimings, null);
  assert.ok(fs.statSync(metadata.path).size > 44);
});

test('scriptFile narration reads text safely and generates audio', async () => {
  const root = temporaryRoot();
  const scripts = path.join(root, 'scripts');
  fs.mkdirSync(scripts);
  fs.writeFileSync(path.join(scripts, 'story.txt'), 'Toronto comes into view.');
  const job = fixture();
  job.narration = {
    scriptFile: '/scripts/story.txt',
    provider: 'mock',
    voice: 'default',
  };
  const metadata = await prepareNarration(job, {
    scriptRoot: scripts,
    outputDirectory: root,
    durationProbe: wavDuration,
  });
  assert.equal(metadata.duration, 1.2);
  assert.ok(fs.existsSync(metadata.path));
});

test('text and scriptFile or generated and prerecorded narration conflict', () => {
  const job = fixture();
  job.narration = {
    text: 'Hello',
    scriptFile: '/scripts/story.txt',
    provider: 'mock',
    voice: 'default',
  };
  assert.throws(
    () => validateVideoJob(job),
    /exactly one of text or scriptFile/,
  );
  delete job.narration.scriptFile;
  job.audio = { narration: { file: '/audio/manual.wav' } };
  assert.throws(() => validateVideoJob(job), /cannot both be configured/);
});

test('provider credentials and other settings are rejected from job files', () => {
  const job = fixture();
  job.narration = {
    text: 'Hello',
    provider: 'mock',
    voice: 'default',
    apiKey: 'example-only',
  };
  assert.throws(
    () => validateVideoJob(job),
    /provider settings belong outside the job/,
  );
});

test('script path traversal, unsupported extension and missing file fail', () => {
  const root = temporaryRoot();
  for (const scriptFile of [
    '/scripts/../secret.txt',
    '/other/story.txt',
    '/scripts/story.md',
  ]) {
    const job = fixture();
    job.narration = { scriptFile, provider: 'mock', voice: 'default' };
    assert.throws(
      () => validateVideoJob(job),
      /Worldlayer: narration.scriptFile/,
    );
  }
  assert.throws(
    () => loadNarrationScript('/scripts/missing.txt', root),
    /Worldlayer: narration script does not exist/,
  );
});

test('provider registry rejects unknown providers and mock voices', async () => {
  const root = temporaryRoot();
  await assert.rejects(
    generateNarration({
      provider: 'cloud',
      text: 'Hello',
      voice: 'default',
      outputPath: path.join(root, 'a.wav'),
    }),
    /provider "cloud" is unsupported/,
  );
  await assert.rejects(
    generateNarration({
      provider: 'mock',
      text: 'Hello',
      voice: 'other',
      outputPath: path.join(root, 'a.wav'),
    }),
    /mock narration voice "other" is unsupported/,
  );
});

test('generated narration overflow reports audio, visual and excess durations', async () => {
  const job = fixture();
  job.narration = { text: 'One two three', provider: 'mock', voice: 'default' };
  await assert.rejects(
    prepareNarration(job, {
      outputDirectory: temporaryRoot(),
      durationProbe: async () => 24,
    }),
    /duration 24\.00s exceeds visual duration 23\.00s by 1\.00s/,
  );
});
