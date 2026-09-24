import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import {
  editorialDuration,
  createCaptureClock,
  calculateEditorialTrim,
  timingDrift,
  formatTimingSummary,
} from '../../scripts/worldlayer-capture-timing.mjs';
import { editorialVideoFilter } from '../../scripts/worldlayer-media-assembly.mjs';
import { resolveVideoTimeline } from './timelinePlanner.js';
import { createSceneExecutor } from './sceneExecutor.js';

const fixture = (name) =>
  JSON.parse(
    readFileSync(new URL(`../../public/jobs/${name}`, import.meta.url), 'utf8'),
  );
const boundaries = (overrides = {}) => ({
  recordingStart: 99.8,
  firstFrame: 100,
  lastFrame: 106.9,
  jobStart: 100.083,
  jobCompletion: 105.1,
  recordingStop: 107,
  rawDuration: 7,
  plannedDuration: 5,
  fps: 30,
  ...overrides,
});

test('editorial duration uses concrete legacy scene durations', () => {
  assert.equal(editorialDuration(fixture('video-job.json')), 23);
});

test('automatically planned job duration is the editorial authority', () => {
  const resolved = resolveVideoTimeline(fixture('video-job-timeline.json'), {
    narrationDuration: 30.9,
    narrationText: 'One sentence. Another sentence.',
  });
  assert.equal(editorialDuration(resolved.job), 30.9);
});

test('raw capture may be longer than editorial timeline', () => {
  const trim = calculateEditorialTrim(boundaries());
  assert.equal(trim.rawDuration, 7);
  assert.equal(trim.frameCount, 150);
  assert.equal(trim.finalDuration, 5);
  assert.ok(trim.captureLead > 0);
  assert.ok(trim.captureTail > 0);
});

test('trim interval starts on measured first editorial frame', () => {
  const trim = calculateEditorialTrim(boundaries());
  assert.equal(trim.startFrame, 3);
  assert.equal(trim.endFrame, 153);
  assert.equal(trim.trimStart, 0.1);
  assert.equal(
    editorialVideoFilter(trim, 30),
    'trim=start_frame=3:end_frame=153,setpts=N/(30*TB)',
  );
});

test('negative or unavailable trim offsets fail clearly', () => {
  assert.throws(
    () => calculateEditorialTrim(boundaries({ firstFrame: 100.1 })),
    /Worldlayer: capture timing events are out of order/,
  );
  assert.throws(
    () => calculateEditorialTrim(boundaries({ firstFrame: undefined })),
    /Worldlayer: capture timing firstFrame is unavailable/,
  );
});

test('first output video frame and narration both map to editorial zero', () => {
  const trim = calculateEditorialTrim(boundaries({ jobStart: 100 }));
  assert.equal(trim.startFrame, 0);
  assert.equal(trim.trimStart, 0);
  assert.match(editorialVideoFilter(trim, 30), /setpts=N\/\(30\*TB\)$/);
});

test('silent jobs use the same editorial trim', () => {
  const silent = fixture('video-job.json');
  const trim = calculateEditorialTrim(
    boundaries({
      plannedDuration: editorialDuration(silent),
      rawDuration: 25,
      jobCompletion: 123.2,
      lastFrame: 124.9,
      recordingStop: 125,
    }),
  );
  assert.equal(trim.frameCount, 690);
  assert.equal(trim.finalDuration, 23);
});

test('insufficient capture fails before FFmpeg trims the last frame', () => {
  assert.throws(
    () => calculateEditorialTrim(boundaries({ rawDuration: 5 })),
    /Worldlayer: raw capture has .* but editorial trim needs/,
  );
});

test('timing diagnostics show measured lead, tail and final drift', () => {
  const trim = calculateEditorialTrim(boundaries());
  const summary = formatTimingSummary(trim, 5);
  assert.match(summary, /planned: 5\.000s/);
  assert.match(summary, /raw capture: 7\.000s/);
  assert.match(summary, /capture lead: 0\.083s/);
  assert.match(summary, /capture tail: 1\.900s/);
  assert.match(summary, /final: 5\.000s/);
  assert.match(summary, /drift: \+0\.000s \(within one frame\)/);
});

test('one frame tolerance distinguishes acceptable and excessive drift', () => {
  assert.equal(timingDrift(5 + 1 / 30, 5, 30).withinOneFrame, true);
  assert.equal(timingDrift(5 + 2 / 30, 5, 30).withinOneFrame, false);
});

test('capture clock records first and last CDP frame timestamps', async () => {
  const client = new EventEmitter();
  const clock = createCaptureClock(client, () => 100);
  client.emit('Page.screencastFrame', { metadata: { timestamp: 100.1 } });
  client.emit('Page.screencastFrame', { metadata: { timestamp: 100.2 } });
  assert.equal(await clock.firstFrameReady, 100.1);
  assert.deepEqual(clock.snapshot(), {
    recordingStart: 100,
    firstFrame: 100.1,
    lastFrame: 100.2,
  });
  clock.dispose();
  assert.equal(client.listenerCount('Page.screencastFrame'), 0);
});

test('scene executor emits browser-clock job boundaries without waiting', async () => {
  const previousWindow = globalThis.window;
  const previousCustomEvent = globalThis.CustomEvent;
  const events = [];
  globalThis.window = { dispatchEvent: (event) => events.push(event) };
  globalThis.CustomEvent = class {
    constructor(type, options) {
      this.type = type;
      this.detail = options.detail;
    }
  };
  const noWait = async () => {};
  try {
    const cameraController = Object.fromEntries(
      ['flyTo', 'orbit', 'pan', 'zoom', 'hold'].map((name) => [name, noWait]),
    );
    const executor = createSceneExecutor(
      {},
      { cameraController, sleep: noWait },
    );
    await executor.executeJob(fixture('video-job.json'));
    const start = events.find((event) => event.type === 'worldlayer:job-start');
    const completion = events.find(
      (event) => event.type === 'worldlayer:job-complete',
    );
    assert.ok(Number.isFinite(start.detail.timestamp));
    assert.ok(completion.detail.timestamp >= start.detail.timestamp);
  } finally {
    globalThis.window = previousWindow;
    globalThis.CustomEvent = previousCustomEvent;
  }
});
