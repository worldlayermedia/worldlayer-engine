export function createCameraController(viewer) {
  if (!viewer?.camera) {
    throw new Error('Worldlayer: Cesium viewer or camera is unavailable.');
  }

  const Cartesian3 = viewer.camera.position.constructor;

  function toRadians(degrees) {
    return degrees * (Math.PI / 180);
  }

  async function flyTo(cameraConfig) {
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

    return new Promise((resolve, reject) => {
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
  }

  async function orbit(movementConfig) {
    const { degrees = 60, duration = 8 } = movementConfig;

    const startHeading = viewer.camera.heading;
    const targetHeading = startHeading + toRadians(degrees);

    const startTime = performance.now();
    const durationMs = duration * 1000;

    return new Promise((resolve) => {
      function animate(currentTime) {
        const elapsed = currentTime - startTime;

        const progress = Math.min(elapsed / durationMs, 1);

        const easedProgress =
          progress < 0.5
            ? 2 * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 2) / 2;

        const heading =
          startHeading + (targetHeading - startHeading) * easedProgress;

        viewer.camera.setView({
          orientation: {
            heading,
            pitch: viewer.camera.pitch,
            roll: viewer.camera.roll,
          },
        });

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          resolve();
        }
      }

      requestAnimationFrame(animate);
    });
  }

  return {
    flyTo,
    orbit,
  };
}
