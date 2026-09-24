import assert from 'node:assert/strict';
import test from 'node:test';
import { createCameraController } from './cameraController.js';

const cameraConfig = {
  longitude: -79.3832,
  latitude: 43.6532,
  altitude: 10000,
  heading: 20,
  pitch: -55,
  roll: 3,
};

function harness(callback) {
  class Position {
    static fromDegrees(longitude, latitude, altitude) {
      return { longitude, latitude, altitude };
    }
  }
  let clock = 0;
  const waits = [];
  const flights = [];
  const viewer = {
    camera: {
      position: new Position(),
      flyTo: (options) => {
        flights.push(options);
        callback(options, (milliseconds) => {
          clock += milliseconds;
        });
      },
    },
  };
  const controller = createCameraController(viewer, {
    now: () => clock,
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
      clock += milliseconds;
    },
  });
  return { controller, waits, flights, now: () => clock };
}

test('short flyTo fills only its missing time and preserves orientation', async () => {
  const flight = harness(({ complete }, advance) => {
    advance(250);
    complete();
  });
  await flight.controller.flyTo({ ...cameraConfig, flightDuration: 1 });
  assert.deepEqual(flight.waits, [750]);
  assert.equal(flight.now(), 1000);
  assert.deepEqual(flight.flights[0].destination, {
    longitude: cameraConfig.longitude,
    latitude: cameraConfig.latitude,
    altitude: cameraConfig.altitude,
  });
  for (const [axis, degrees] of [
    ['heading', 20],
    ['pitch', -55],
    ['roll', 3],
  ])
    assert.ok(
      Math.abs(
        flight.flights[0].orientation[axis] - degrees * (Math.PI / 180),
      ) < 1e-12,
    );
});

test('long flyTo that exceeds its configured duration gets no extra wait', async () => {
  const flight = harness(({ complete }, advance) => {
    advance(6000);
    complete();
  });
  await flight.controller.flyTo({ ...cameraConfig, flightDuration: 5 });
  assert.deepEqual(flight.waits, []);
  assert.equal(flight.now(), 6000);
});

test('early Cesium flight completion still occupies configured duration', async () => {
  const flight = harness(({ complete }) => complete());
  await flight.controller.flyTo({ ...cameraConfig, flightDuration: 4 });
  assert.deepEqual(flight.waits, [4000]);
  assert.equal(flight.now(), 4000);
});

test('Cesium cancellation still rejects without entering the timing hold', async () => {
  const flight = harness(({ cancel }) => cancel());
  await assert.rejects(
    flight.controller.flyTo({ ...cameraConfig, flightDuration: 4 }),
    /Worldlayer: camera flight cancelled/,
  );
  assert.deepEqual(flight.waits, []);
});
