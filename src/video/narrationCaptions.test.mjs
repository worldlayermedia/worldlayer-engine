import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateVideoJob } from './jobValidation.js';
import { narrationConfig } from '../../scripts/worldlayer-audio-config.mjs';
import {
  captionsToSrt,
  captionedFilename,
} from '../../scripts/worldlayer-captions.mjs';
import {
  assertNarrationFits,
  packetDuration,
} from '../../scripts/worldlayer-media-assembly.mjs';

const fixture = () =>
  JSON.parse(
    readFileSync(
      new URL('../../public/jobs/video-job.json', import.meta.url),
      'utf8',
    ),
  );

test('job without audio or captions remains valid', () => {
  assert.equal(validateVideoJob(fixture()).audio, undefined);
  assert.equal(narrationConfig(fixture()), null);
});

test('valid narration schema and local WAV or MP3 files', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'worldlayer-audio-'));
  writeFileSync(path.join(root, 'voice.wav'), 'fixture');
  writeFileSync(path.join(root, 'voice.mp3'), 'fixture');
  for (const extension of ['wav', 'mp3']) {
    const job = fixture();
    job.audio = { narration: { file: `/audio/voice.${extension}` } };
    validateVideoJob(job);
    assert.equal(narrationConfig(job, root).extension, `.${extension}`);
  }
});

test('invalid narration paths and unsupported extensions fail', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'worldlayer-audio-'));
  for (const file of [
    '/audio/../secret.wav',
    '/other/voice.wav',
    '/audio/voice.flac',
  ]) {
    const job = fixture();
    job.audio = { narration: { file } };
    assert.throws(
      () => validateVideoJob(job),
      /Worldlayer: audio.narration.file/,
    );
  }
  const job = fixture();
  job.audio = { narration: { file: '/audio/missing.wav' } };
  validateVideoJob(job);
  assert.throws(
    () => narrationConfig(job, root),
    /Worldlayer: narration file does not exist/,
  );
});

test(
  'narration symlink cannot escape media directory',
  { skip: process.platform === 'win32' && !process.env.CI },
  () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'worldlayer-audio-'));
    const outside = mkdtempSync(path.join(os.tmpdir(), 'worldlayer-other-'));
    writeFileSync(path.join(outside, 'voice.wav'), 'fixture');
    symlinkSync(path.join(outside, 'voice.wav'), path.join(root, 'voice.wav'));
    const job = fixture();
    job.audio = { narration: { file: '/audio/voice.wav' } };
    assert.throws(
      () => narrationConfig(job, root),
      /Worldlayer: narration path escapes/,
    );
  },
);

test('valid ordered captions and SRT formatting', () => {
  const job = fixture();
  job.captions = [
    { start: 0, end: 3.2, text: 'First line' },
    { start: 3.2, end: 5, text: 'Second line' },
  ];
  validateVideoJob(job);
  assert.equal(
    captionsToSrt(job.captions),
    '1\n00:00:00,000 --> 00:00:03,200\nFirst line\n\n2\n00:00:03,200 --> 00:00:05,000\nSecond line\n',
  );
  assert.equal(
    captionedFilename('worldlayer-mvp'),
    'worldlayer-mvp-captioned.mp4',
  );
});

test('malformed or overlapping captions fail', () => {
  const cases = [
    [{ start: -1, end: 2, text: 'A' }],
    [{ start: 2, end: 2, text: 'A' }],
    [{ start: 0, end: 1, text: '  ' }],
    [
      { start: 0, end: 3, text: 'A' },
      { start: 2, end: 4, text: 'B' },
    ],
    [{ start: 0, end: 24, text: 'Too late' }],
  ];
  for (const captions of cases) {
    const job = fixture();
    job.captions = captions;
    assert.throws(() => validateVideoJob(job), /Worldlayer:/);
  }
});

test('narration may end early but cannot exceed video beyond tolerance', () => {
  assert.doesNotThrow(() => assertNarrationFits(16, 23));
  assert.doesNotThrow(() => assertNarrationFits(23.4, 23, 0.5));
  assert.throws(
    () => assertNarrationFits(23.6, 23, 0.5),
    /Worldlayer: narration duration/,
  );
});

test('WebM packet timestamps provide duration when metadata is unavailable', () => {
  assert.equal(packetDuration('0.000,0.033\n0.033,0.033\n0.067,0.033\n'), 0.1);
});
