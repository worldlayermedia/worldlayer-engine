import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateVideoJob } from './jobValidation.js';
import { planSceneTimeline, resolveVideoTimeline } from './timelinePlanner.js';
import { scriptCaptions, segmentNarration } from './scriptCaptions.js';
import { captionsToSrt } from '../../scripts/worldlayer-captions.mjs';

const fixture = () =>
  JSON.parse(
    readFileSync(
      new URL('../../public/jobs/video-job.json', import.meta.url),
      'utf8',
    ),
  );
const timelineFixture = () =>
  JSON.parse(
    readFileSync(
      new URL('../../public/jobs/video-job-timeline.json', import.meta.url),
      'utf8',
    ),
  );
const scene = (id, timing) => ({
  id,
  name: id,
  camera: { longitude: 0, latitude: 0, altitude: 1000, flightDuration: 0 },
  ...(timing ? { timing } : {}),
});

test('all weighted scenes and automatic defaults divide narration proportionally', () => {
  const planned = planSceneTimeline(
    [
      scene('a', { mode: 'weighted', weight: 2 }),
      scene('b'),
      scene('c', { mode: 'weighted', weight: 3 }),
    ],
    18,
  );
  assert.deepEqual(
    planned.scenes.map((item) => item.duration),
    [6, 3, 9],
  );
  assert.equal(planned.scenes[2].end, 18);
});

test('fixed scenes consume time before weighted allocation', () => {
  const planned = planSceneTimeline(
    [
      scene('fixed', { mode: 'fixed', duration: 4 }),
      scene('light', { mode: 'weighted', weight: 1 }),
      scene('heavy', { mode: 'weighted', weight: 3 }),
    ],
    16,
  );
  assert.deepEqual(
    planned.scenes.map((item) => item.duration),
    [4, 3, 9],
  );
  assert.deepEqual(
    planned.scenes.map((item) => item.start),
    [0, 4, 7],
  );
});

test('legacy scene.duration is unchanged and does not require narration', () => {
  const job = fixture();
  const original = structuredClone(job);
  const resolved = resolveVideoTimeline(job);
  assert.equal(resolved.changed, false);
  assert.deepEqual(resolved.job, original);
  assert.deepEqual(
    resolved.timeline.scenes.map((item) => item.duration),
    [5, 5, 13],
  );
});

test('minimum duration clamps short weighted scenes and redistributes time', () => {
  const planned = planSceneTimeline(
    [
      scene('short', { mode: 'weighted', weight: 1 }),
      scene('long', { mode: 'weighted', weight: 10 }),
    ],
    7,
    { minimumSceneDuration: 2 },
  );
  assert.deepEqual(
    planned.scenes.map((item) => item.duration),
    [2, 5],
  );
});

test('impossible allocations fail instead of producing zero or negative scenes', () => {
  assert.throws(
    () =>
      planSceneTimeline([scene('a'), scene('b')], 3, {
        minimumSceneDuration: 2,
      }),
    /Worldlayer: impossible timeline/,
  );
  assert.throws(
    () =>
      planSceneTimeline(
        [scene('fixed', { mode: 'fixed', duration: 5 }), scene('weighted')],
        4,
      ),
    /Worldlayer: impossible timeline/,
  );
  assert.throws(
    () =>
      planSceneTimeline([scene('a'), scene('b')], 1.9995, {
        minimumSceneDuration: 1,
      }),
    /Worldlayer: impossible timeline/,
  );
});

test('automatic timing without narration duration fails clearly', () => {
  assert.throws(
    () => resolveVideoTimeline(timelineFixture()),
    /Worldlayer: automatic timeline requires narration duration/,
  );
});

test('movement and flight overflow after allocation fails clearly', () => {
  const moving = scene('moving', { mode: 'weighted', weight: 1 });
  moving.camera.flightDuration = 5;
  moving.movements = [{ type: 'hold', duration: 3 }];
  assert.throws(
    () => planSceneTimeline([moving], 7),
    /timed operations 8\.000s exceed allocated duration 7\.000s/,
  );
});

test('allocation is deterministic, pure and matches narration duration', () => {
  const scenes = [
    scene('a', { mode: 'fixed', duration: 2.1 }),
    scene('b', { mode: 'weighted', weight: 2 }),
    scene('c'),
  ];
  const original = structuredClone(scenes);
  const first = planSceneTimeline(scenes, 10.123, {
    minimumSceneDuration: 0.5,
  });
  const second = planSceneTimeline(scenes, 10.123, {
    minimumSceneDuration: 0.5,
  });
  assert.deepEqual(first, second);
  assert.deepEqual(scenes, original);
  assert.ok(Math.abs(first.totalVisualDuration - 10.123) < 0.001);
});

test('script captions segment sentences and split long sentences', () => {
  const text =
    'First sentence. One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen! Last one?';
  const segments = segmentNarration(text, { maxWords: 6 });
  assert.equal(segments[0], 'First sentence.');
  assert.ok(
    segments.some((segment) =>
      segment.startsWith('One two three four five six'),
    ),
  );
  assert.ok(segments.every((segment) => segment.split(' ').length <= 6));
  assert.equal(segments.at(-1), 'Last one?');
});

test('automatic captions are ordered, non-overlapping, SRT-valid and end within narration', () => {
  const captions = scriptCaptions(
    'One short sentence. Another, longer sentence with more words.',
    5.123,
  );
  assert.equal(captions[0].start, 0);
  assert.equal(captions.at(-1).end, 5.123);
  for (const [index, caption] of captions.entries()) {
    assert.ok(caption.end > caption.start);
    if (index) assert.equal(caption.start, captions[index - 1].end);
  }
  assert.match(captionsToSrt(captions), /00:00:00,000 -->/);
});

test('resolved Toronto job has concrete scene durations and script captions without changing source', () => {
  const job = timelineFixture();
  const original = structuredClone(job);
  const result = resolveVideoTimeline(job, {
    narrationDuration: 30,
    narrationText: 'One sentence. A second sentence explains the city.',
  });
  assert.equal(result.changed, true);
  assert.deepEqual(job, original);
  assert.equal(result.timeline.totalVisualDuration, 30);
  assert.equal(result.job.scenes[0].duration, 5);
  assert.ok(
    result.job.scenes.every(
      (item) => item.duration > 0 && item.timing === undefined,
    ),
  );
  assert.ok(result.job.captions.length >= 2);
  assert.equal(result.job.captionMode, undefined);
  validateVideoJob(result.job);
});

test('manual and script captions cannot be configured together', () => {
  const job = timelineFixture();
  job.captions = [{ start: 0, end: 1, text: 'Manual' }];
  assert.throws(
    () => validateVideoJob(job),
    /captionMode and manual captions cannot both/,
  );
});
