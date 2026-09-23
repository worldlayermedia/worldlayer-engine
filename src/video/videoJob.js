import { createSceneExecutor } from './sceneExecutor.js';

export async function runVideoJob(viewer, jobUrl = '/jobs/video-job.json') {
  let videoJob = jobUrl;
  if (typeof jobUrl === 'string') {
    const response = await fetch(jobUrl);
    if (!response.ok) {
      throw new Error(
        `Worldlayer: failed to load video job (${response.status}).`,
      );
    }
    videoJob = await response.json();
  }

  const executor = createSceneExecutor(viewer);

  await executor.executeJob(videoJob);

  return videoJob;
}
