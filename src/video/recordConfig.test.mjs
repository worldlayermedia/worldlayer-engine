import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { recordConfig } from '../../scripts/worldlayer-record-config.mjs';

const fixture = () =>
  JSON.parse(
    readFileSync(
      new URL('../../public/jobs/video-job.json', import.meta.url),
      'utf8',
    ),
  );

test('recorder settings come from the validated job', () => {
  const job = fixture();
  job.output.filename = 'custom-video';
  job.video.resolution = { width: 1280, height: 720 };
  job.video.fps = 24;
  const config = recordConfig(job, path.resolve('renders'));
  assert.equal(config.width, 1280);
  assert.equal(config.height, 720);
  assert.equal(config.fps, 24);
  assert.match(config.webmPath, /custom-video\.webm$/);
  assert.match(config.mp4Path, /custom-video\.mp4$/);
  assert.equal(config.jobTimeoutMs, 83_000);
  assert.equal(config.ffmpegTimeoutMs, 230_000);
});

test('recorder rejects unsafe output names before writing files', () => {
  const job = fixture();
  job.output.filename = '../escape';
  assert.throws(() => recordConfig(job), /Worldlayer: output.filename/);
});

test('recorder accepts MP4 only', () => {
  const job = fixture();
  job.output.format = 'mov';
  assert.throws(() => recordConfig(job), /Worldlayer: output.format/);
});
