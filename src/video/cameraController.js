export function createCameraController(viewer) {
  if (!viewer?.camera) {
    throw new Error("Worldlayer: Cesium viewer or camera is unavailable.");
  }

  const Cartesian3 = viewer.camera.position.constructor;

  async function flyTo(cameraConfig) {
    const {
      longitude,
      latitude,
      altitude,
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
        duration: flightDuration,
        complete: resolve,
        cancel: () => reject(
          new Error("Worldlayer: camera flight cancelled.")
        ),
      });
    });
  }

  return {
    flyTo,
  };
}