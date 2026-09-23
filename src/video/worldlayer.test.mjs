import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateVideoJob } from './jobValidation.js';
import { calculateSceneTiming } from './sceneTiming.js';
import { createSceneExecutor } from './sceneExecutor.js';

const fixture = () =>
  JSON.parse(
    readFileSync(
      new URL('../../public/jobs/video-job.json', import.meta.url),
      'utf8',
    ),
  );

test('Toronto MVP job is valid', () =>
  assert.equal(validateVideoJob(fixture()).scenes.length, 3));
test('invalid coordinates fail', () => {
  const job = fixture();
  job.scenes[0].camera.latitude = 91;
  assert.throws(() => validateVideoJob(job), /Worldlayer:.*latitude/);
});
test('invalid durations fail', () => {
  const job = fixture();
  job.scenes[2].duration = 12;
  assert.throws(
    () => validateVideoJob(job),
    /Worldlayer:.*timed operations exceed/,
  );
  job.scenes[2].duration = 13;
  job.scenes[2].movements[0].duration = -1;
  assert.throws(
    () => validateVideoJob(job),
    /Worldlayer:.*movements\[0\].duration/,
  );
});
test('duplicate scene IDs fail', () => {
  const job = fixture();
  job.scenes[1].id = job.scenes[0].id;
  assert.throws(() => validateVideoJob(job), /Worldlayer: duplicate scene id/);
});
test('unsupported movement fails', () => {
  const job = fixture();
  job.scenes[2].movements[0].type = 'track';
  assert.throws(() => validateVideoJob(job), /Worldlayer:.*unsupported/);
});
test('timing subtracts every timed operation', () => {
  const scene = fixture().scenes[2];
  assert.deepEqual(calculateSceneTiming(scene), {
    flightDuration: 5,
    movementDuration: 8,
    holdDuration: 0,
  });
});

async function runScene(scene) {
  const calls = [];
  const previousWindow = globalThis.window;
  globalThis.window = { dispatchEvent: () => {} };
  const previousCustomEvent = globalThis.CustomEvent;
  globalThis.CustomEvent = class {
    constructor(type, options) {
      this.type = type;
      this.detail = options.detail;
    }
  };
  try {
    const cameraController = {
      flyTo: async () => calls.push('fly'),
      orbit: async () => calls.push('orbit'),
      pan: async () => calls.push('pan'),
      zoom: async () => calls.push('zoom'),
      hold: async (movement) => calls.push(`hold:${movement.duration}`),
    };
    const executor = createSceneExecutor(
      { camera: {} },
      { cameraController, sleep: async (ms) => calls.push(ms) },
    );
    await executor.executeScene(scene);
    return calls;
  } finally {
    globalThis.window = previousWindow;
    globalThis.CustomEvent = previousCustomEvent;
  }
}

test('scene with only flyTo has no extra hold', async () => {
  assert.deepEqual(await runScene(fixture().scenes[0]), ['fly']);
});
test('legacy movement remains compatible', async () => {
  const scene = fixture().scenes[2];
  scene.movement = scene.movements[0];
  delete scene.movements;
  scene.duration = 8;
  assert.deepEqual(await runScene(scene), ['fly', 'orbit']);
});
test('scene executes movement array in order without extra hold', async () => {
  assert.deepEqual(await runScene(fixture().scenes[2]), [
    'fly',
    'orbit',
    'pan',
    'zoom',
    'hold:1',
  ]);
});
test('scene with movements and remaining time uses automatic hold', async () => {
  const scene = fixture().scenes[2];
  scene.duration = 15;
  assert.deepEqual(await runScene(scene), [
    'fly',
    'orbit',
    'pan',
    'zoom',
    'hold:1',
    2000,
  ]);
});
