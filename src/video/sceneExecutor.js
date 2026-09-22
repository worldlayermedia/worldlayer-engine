import { createCameraController } from "./cameraController.js";

export function createSceneExecutor(viewer) {
  const cameraController = createCameraController(viewer);

  async function executeScene(scene) {
    console.log(
      `[Worldlayer] Starting ${scene.id}: ${scene.name}`
    );

    await cameraController.flyTo(scene.camera);

    console.log(
      `[Worldlayer] Completed ${scene.id}: ${scene.name}`
    );
  }

  async function executeJob(videoJob) {
    if (!videoJob?.scenes?.length) {
      throw new Error("Worldlayer: video job contains no scenes.");
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