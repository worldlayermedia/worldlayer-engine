import { createCameraController } from "./cameraController.js";

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export function createSceneExecutor(viewer) {
  const cameraController = createCameraController(viewer);

  async function executeScene(scene) {
    console.log(
      `[Worldlayer] Starting ${scene.id}: ${scene.name}`
    );

    window.__worldlayerCurrentScene = scene.id;

    const flightDuration =
      scene.camera?.flightDuration ?? 0;

    const sceneDuration =
      scene.duration ?? flightDuration;

    await cameraController.flyTo(scene.camera);

    const remainingDuration = Math.max(
      0,
      sceneDuration - flightDuration
    );

    if (remainingDuration > 0) {
      console.log(
        `[Worldlayer] Holding ${scene.id} for ${remainingDuration}s`
      );

      await wait(remainingDuration * 1000);
    }

    window.dispatchEvent(
      new CustomEvent("worldlayer:scene-complete", {
        detail: {
          id: scene.id,
          name: scene.name,
        },
      })
    );

    console.log(
      `[Worldlayer] Completed ${scene.id}: ${scene.name}`
    );
  }

  async function executeJob(videoJob) {
    if (!videoJob?.scenes?.length) {
      throw new Error(
        "Worldlayer: video job contains no scenes."
      );
    }

    console.log(
      `[Worldlayer] Starting job: ${videoJob.title}`
    );

    for (const scene of videoJob.scenes) {
      await executeScene(scene);
    }

    console.log("[Worldlayer] Job completed.");
  }

  return {
    executeScene,
    executeJob,
  };
}