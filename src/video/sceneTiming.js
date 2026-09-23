import { sceneMovements } from './movementList.js';

export function calculateSceneTiming(scene) {
  const flightDuration = scene.camera.flightDuration;
  const movementDuration = sceneMovements(scene).reduce(
    (total, movement) => total + movement.duration,
    0,
  );
  const holdDuration = Math.max(
    0,
    scene.duration - flightDuration - movementDuration,
  );
  return { flightDuration, movementDuration, holdDuration };
}
