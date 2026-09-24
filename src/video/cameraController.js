import { createMovementHandlers } from './movementHandlers.js';

export function createCameraController(
  viewer,
  {
    now = () => performance.now(),
    sleep = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  } = {},
) {
  if (!viewer?.camera) {
    throw new Error('Worldlayer: Cesium viewer or camera is unavailable.');
  }

  const Cartesian3 = viewer.camera.position.constructor;

  function toRadians(degrees) {
    return degrees * (Math.PI / 180);
  }

  async function flyTo(cameraConfig) {
    const started = now();
    const {
      longitude,
      latitude,
      altitude,
      heading = 0,
      pitch = -90,
      roll = 0,
      flightDuration = 5,
    } = cameraConfig;

    const destination = Cartesian3.fromDegrees(longitude, latitude, altitude);

    await new Promise((resolve, reject) => {
      viewer.camera.flyTo({
        destination,
        orientation: {
          heading: toRadians(heading),
          pitch: toRadians(pitch),
          roll: toRadians(roll),
        },
        duration: flightDuration,
        complete: resolve,
        cancel: () => reject(new Error('Worldlayer: camera flight cancelled.')),
      });
    });
    // Cesium may complete early when the destination is already close. The
    // configured flight still owns its full slot in the editorial timeline.
    const remaining = flightDuration * 1000 - (now() - started);
    if (remaining > 0) await sleep(remaining);
  }

  return {
    flyTo,
    ...createMovementHandlers(viewer),
  };
}
