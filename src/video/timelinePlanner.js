import { validateVideoJob } from './jobValidation.js';
import { sceneMovements } from './movementList.js';
import { scriptCaptions } from './scriptCaptions.js';

const DEFAULT_MINIMUM_SCENE_DURATION = 0.25;
const TIMELINE_TOLERANCE = 0.001;

export function needsTimelinePlanning(job) {
  return job.scenes.some(
    (scene) => scene.timing !== undefined || scene.duration === undefined,
  );
}

function sceneTimeline(scenes) {
  let start = 0;
  return scenes.map((scene) => {
    const end = start + scene.duration;
    const entry = { id: scene.id, start, end, duration: scene.duration };
    start = end;
    return entry;
  });
}

export function planSceneTimeline(
  scenes,
  narrationDuration,
  {
    minimumSceneDuration = DEFAULT_MINIMUM_SCENE_DURATION,
    tolerance = TIMELINE_TOLERANCE,
  } = {},
) {
  if (!Number.isFinite(narrationDuration) || narrationDuration <= 0)
    throw new Error(
      'Worldlayer: automatic timeline requires narration duration.',
    );
  if (!Number.isFinite(minimumSceneDuration) || minimumSceneDuration <= 0)
    throw new Error('Worldlayer: minimum scene duration must be positive.');
  const durations = Array(scenes.length);
  const weighted = [];
  let fixedTotal = 0;
  for (const [index, scene] of scenes.entries()) {
    const fixed =
      scene.timing?.mode === 'fixed' ? scene.timing.duration : scene.duration;
    if (fixed !== undefined) {
      if (fixed < minimumSceneDuration)
        throw new Error(
          `Worldlayer: scene "${scene.id}" fixed duration ${fixed}s is below minimum ${minimumSceneDuration}s.`,
        );
      durations[index] = fixed;
      fixedTotal += fixed;
    } else {
      weighted.push({ index, weight: scene.timing?.weight ?? 1 });
    }
  }
  let remaining = narrationDuration - fixedTotal;
  if (remaining < weighted.length * minimumSceneDuration - 1e-9)
    throw new Error(
      `Worldlayer: impossible timeline: ${remaining.toFixed(3)}s remains for ${weighted.length} weighted scenes with ${minimumSceneDuration}s minimum each.`,
    );
  if (!weighted.length && Math.abs(remaining) > tolerance)
    throw new Error(
      `Worldlayer: fixed scenes total ${fixedTotal.toFixed(3)}s does not match narration ${narrationDuration.toFixed(3)}s.`,
    );
  let active = weighted;
  while (active.length) {
    const weightTotal = active.reduce((sum, item) => sum + item.weight, 0);
    const clamped = active.filter(
      (item) =>
        (remaining * item.weight) / weightTotal < minimumSceneDuration - 1e-9,
    );
    if (!clamped.length) {
      for (const item of active)
        durations[item.index] = (remaining * item.weight) / weightTotal;
      break;
    }
    for (const item of clamped) {
      durations[item.index] = minimumSceneDuration;
      remaining -= minimumSceneDuration;
    }
    active = active.filter((item) => !clamped.includes(item));
  }
  const resolvedScenes = scenes.map((scene, index) => ({
    ...scene,
    duration: durations[index],
  }));
  for (const scene of resolvedScenes) {
    const operations =
      scene.camera.flightDuration +
      sceneMovements(scene).reduce(
        (sum, movement) => sum + movement.duration,
        0,
      );
    if (operations > scene.duration + 1e-9)
      throw new Error(
        `Worldlayer: scene "${scene.id}" timed operations ${operations.toFixed(3)}s exceed allocated duration ${scene.duration.toFixed(3)}s.`,
      );
  }
  const totalVisualDuration = durations.reduce(
    (sum, duration) => sum + duration,
    0,
  );
  if (Math.abs(totalVisualDuration - narrationDuration) > tolerance)
    throw new Error(
      'Worldlayer: planned timeline does not match narration duration.',
    );
  return {
    narrationDuration,
    totalVisualDuration,
    scenes: sceneTimeline(resolvedScenes),
  };
}

export function resolveVideoTimeline(
  job,
  { narrationDuration, narrationText } = {},
) {
  validateVideoJob(job);
  const planned = needsTimelinePlanning(job);
  const resolvedJob = structuredClone(job);
  let timeline;
  if (planned) {
    timeline = planSceneTimeline(job.scenes, narrationDuration, {
      minimumSceneDuration: job.timeline?.minimumSceneDuration,
    });
    resolvedJob.scenes.forEach((scene, index) => {
      scene.duration = timeline.scenes[index].duration;
      delete scene.timing;
    });
  } else {
    const scenes = sceneTimeline(resolvedJob.scenes);
    timeline = {
      narrationDuration: narrationDuration ?? null,
      totalVisualDuration: scenes.at(-1).end,
      scenes,
    };
  }
  if (job.captionMode === 'script') {
    if (typeof narrationText !== 'string' || !narrationText.trim())
      throw new Error('Worldlayer: script captions require narration text.');
    resolvedJob.captions = scriptCaptions(narrationText, narrationDuration);
    delete resolvedJob.captionMode;
  }
  validateVideoJob(resolvedJob);
  return {
    job: resolvedJob,
    timeline: { ...timeline, captions: resolvedJob.captions ?? [] },
    changed: planned || job.captionMode === 'script',
  };
}
