import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { animateMovement } from './easing.js';
import { createMovementHandlers } from './movementHandlers.js';

const cameraLocation = {
  longitude: -79.3832,
  latitude: 43.6532,
  altitude: 15000,
};

function fixture() {
  const events = [];
  const position = Cesium.Cartesian3.fromDegrees(
    cameraLocation.longitude,
    cameraLocation.latitude,
    cameraLocation.altitude,
  );
  const camera = {
    position,
    positionWC: position,
    directionWC: new Cesium.Cartesian3(0, 0, -1),
    upWC: new Cesium.Cartesian3(0, 1, 0),
    positionCartographic: { height: cameraLocation.altitude },
    heading: 0,
    pitch: -1,
    roll: 0,
    lookAt: (target, hpr) => events.push({ type: 'lookAt', target, hpr }),
    lookAtTransform: () => events.push({ type: 'resetTransform' }),
    setView: () => events.push({ type: 'setView' }),
    moveRight: (meters) => events.push({ type: 'right', meters }),
    moveUp: (meters) => events.push({ type: 'up', meters }),
    moveForward: (meters) => events.push({ type: 'forward', meters }),
  };
  const viewer = { camera, scene: { requestRender: () => {} } };
  const handlers = createMovementHandlers(viewer, {
    animate: async (_movement, update) => {
      update(0);
      update(0.5);
      update(1);
    },
    sleep: async (milliseconds) => events.push({ type: 'sleep', milliseconds }),
  });
  return { events, handlers };
}

test('orbit changes camera position around one geographic target', async () => {
  const { events, handlers } = fixture();
  await handlers.orbit({ degrees: 45, duration: 3 }, cameraLocation);
  const frames = events.filter(({ type }) => type === 'lookAt');
  assert.equal(frames.length, 3);
  assert.equal(frames[0].target, frames[1].target);
  assert.ok(frames[2].hpr.heading > frames[0].hpr.heading);
  assert.ok(frames.every(({ hpr }) => hpr.range > 0));
  assert.ok(events.some(({ type }) => type === 'resetTransform'));
});

test('pan applies cumulative horizontal and vertical movement', async () => {
  const { events, handlers } = fixture();
  await handlers.pan({
    horizontalMeters: 800,
    verticalMeters: -200,
    duration: 2,
  });
  assert.equal(
    events
      .filter(({ type }) => type === 'right')
      .reduce((sum, item) => sum + item.meters, 0),
    800,
  );
  assert.equal(
    events
      .filter(({ type }) => type === 'up')
      .reduce((sum, item) => sum + item.meters, 0),
    -200,
  );
});

test('zoom dollies forward by the configured distance factor', async () => {
  const { events, handlers } = fixture();
  await handlers.zoom({ factor: 0.75, duration: 2 }, cameraLocation);
  const moved = events
    .filter(({ type }) => type === 'forward')
    .reduce((sum, item) => sum + item.meters, 0);
  assert.ok(moved > 3000 && moved < 4500);
});

test('hold waits only its configured duration', async () => {
  const { events, handlers } = fixture();
  await handlers.hold({ duration: 1.5 });
  assert.deepEqual(events, [{ type: 'sleep', milliseconds: 1500 }]);
});

test('animation applies easing to elapsed time without real waits', async () => {
  const queue = [];
  const values = [];
  const running = animateMovement(
    { duration: 1, easing: 'easeIn' },
    (value) => values.push(value),
    { now: () => 0, requestFrame: (frame) => queue.push(frame) },
  );
  queue.shift()(0);
  queue.shift()(500);
  queue.shift()(1000);
  await running;
  assert.deepEqual(values, [0, 0.25, 1]);
});
