import { createCameraController } from './cameraController.js';
import { validateVideoJob } from './jobValidation.js';
import { calculateSceneTiming } from './sceneTiming.js';

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export function createSceneExecutor(
  viewer,
  { cameraController = createCameraController(viewer), sleep = wait } = {},
) {
  const movements = {
    orbit: (config) => cameraController.orbit(config),
  };

  async function executeScene(scene) {
    console.log(`[Worldlayer] Starting ${scene.id}: ${scene.name}`);

    window.__worldlayerCurrentScene = scene.id;

    const { holdDuration } = calculateSceneTiming(scene);

    await cameraController.flyTo(scene.camera);

    if (scene.movement) {
      await movements[scene.movement.type](scene.movement);
    }

    if (holdDuration > 0) {
      console.log(`[Worldlayer] Holding ${scene.id} for ${holdDuration}s`);

      await sleep(holdDuration * 1000);
    }

    window.dispatchEvent(
      new CustomEvent('worldlayer:scene-complete', {
        detail: {
          id: scene.id,
          name: scene.name,
        },
      }),
    );

    console.log(`[Worldlayer] Completed ${scene.id}: ${scene.name}`);
  }

  async function executeJob(videoJob) {
    validateVideoJob(videoJob);

    console.log(`[Worldlayer] Starting job: ${videoJob.title}`);

    for (const scene of videoJob.scenes) {
      await executeScene(scene);
    }

    console.log('[Worldlayer] Job completed.');
  }

  return {
    executeScene,
    executeJob,
  };
}
