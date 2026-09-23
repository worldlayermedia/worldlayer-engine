/** Return the scene's configured movements in execution order. */
export function sceneMovements(scene) {
  if (scene.movements !== undefined) return scene.movements;
  return scene.movement === undefined ? [] : [scene.movement];
}
