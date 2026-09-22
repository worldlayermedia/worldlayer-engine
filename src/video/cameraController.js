export function createCameraController(viewer) {
  if (!viewer?.camera) {
    throw new Error(
      "Worldlayer: Cesium viewer or camera is unavailable."
    );
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

    const destination = Cartesian3.fromDegrees(
      longitude,
      latitude,
      altitude
    );

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
        cancel: () =>
          reject(
            new Error(
              "Worldlayer: camera flight cancelled."
            )
          ),
      });
    });
  }

  return {
    flyTo,
  };
}