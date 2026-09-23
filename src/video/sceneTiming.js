export function calculateSceneTiming(scene) {
  const flightDuration = scene.camera.flightDuration;
  const movementDuration = scene.movement?.duration ?? 0;
  const holdDuration = Math.max(
    0,
    scene.duration - flightDuration - movementDuration,
  );
  return { flightDuration, movementDuration, holdDuration };
}
