import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateVideoJob } from './jobValidation.js';
import { calculateSceneTiming } from './sceneTiming.js';
import { sceneMovements } from './movementList.js';
import { easingFunctions } from './easing.js';

function fixture() {
  return JSON.parse(
    readFileSync(
      new URL('../../public/jobs/video-job.json', import.meta.url),
      'utf8',
    ),
  );
}

test('ordered movements are valid and total the scene duration', () => {
  const job = fixture();
  assert.equal(validateVideoJob(job), job);
  assert.deepEqual(
    sceneMovements(job.scenes[2]).map(({ type }) => type),
    ['orbit', 'pan', 'zoom', 'hold'],
  );
  assert.deepEqual(calculateSceneTiming(job.scenes[2]), {
    flightDuration: 5,
    movementDuration: 8,
    holdDuration: 0,
  });
});

test('legacy movement is accepted, but both fields are rejected', () => {
  const job = fixture();
  const scene = job.scenes[2];
  scene.movement = scene.movements[0];
  delete scene.movements;
  scene.duration = 8;
  assert.equal(validateVideoJob(job), job);
  scene.movements = [scene.movement];
  assert.throws(
    () => validateVideoJob(job),
    /Worldlayer:.*both movement and movements/,
  );
});

test('unsupported movement and easing fail validation', () => {
  const job = fixture();
  job.scenes[2].movements[1].type = 'follow';
  assert.throws(
    () => validateVideoJob(job),
    /Worldlayer:.*movements\[1\].type.*unsupported/,
  );
  job.scenes[2].movements[1].type = 'pan';
  job.scenes[2].movements[1].easing = 'bounce';
  assert.throws(
    () => validateVideoJob(job),
    /Worldlayer:.*easing.*unsupported/,
  );
});

test('orbit requires finite degrees and valid target coordinates', () => {
  const job = fixture();
  const orbit = job.scenes[2].movements[0];
  delete orbit.degrees;
  assert.throws(() => validateVideoJob(job), /Worldlayer:.*degrees/);
  orbit.degrees = 45;
  orbit.target = { longitude: -79.3, latitude: 91 };
  assert.throws(() => validateVideoJob(job), /Worldlayer:.*target.latitude/);
});

test('pan requires horizontal or vertical meters', () => {
  const job = fixture();
  const pan = job.scenes[2].movements[1];
  delete pan.horizontalMeters;
  delete pan.verticalMeters;
  assert.throws(
    () => validateVideoJob(job),
    /Worldlayer:.*requires horizontalMeters or verticalMeters/,
  );
  pan.verticalMeters = Infinity;
  assert.throws(() => validateVideoJob(job), /Worldlayer:.*verticalMeters/);
});

test('zoom factor must be positive', () => {
  const job = fixture();
  job.scenes[2].movements[2].factor = 0;
  assert.throws(() => validateVideoJob(job), /Worldlayer:.*factor/);
});

test('explicit hold duration counts toward scene timing', () => {
  const job = fixture();
  job.scenes[2].movements[3].duration = 2;
  assert.throws(
    () => validateVideoJob(job),
    /Worldlayer:.*timed operations exceed/,
  );
  job.scenes[2].duration = 14;
  assert.equal(validateVideoJob(job), job);
  assert.equal(calculateSceneTiming(job.scenes[2]).holdDuration, 0);
});

test('movement array overflow fails before execution', () => {
  const job = fixture();
  job.scenes[2].duration = 12.99;
  assert.throws(
    () => validateVideoJob(job),
    /Worldlayer:.*timed operations exceed/,
  );
});

test('easing functions cover the four supported curves', () => {
  assert.deepEqual(Object.keys(easingFunctions), [
    'linear',
    'easeIn',
    'easeOut',
    'easeInOut',
  ]);
  assert.equal(easingFunctions.linear(0.5), 0.5);
  assert.ok(easingFunctions.easeIn(0.5) < 0.5);
  assert.ok(easingFunctions.easeOut(0.5) > 0.5);
  assert.equal(easingFunctions.easeInOut(0.5), 0.5);
});
