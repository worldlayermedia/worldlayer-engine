export function editorialDuration(job) {
  return job.scenes.reduce((total, scene) => total + scene.duration, 0);
}

export function createCaptureClock(
  client,
  nowSeconds = () => Date.now() / 1000,
) {
  const recordingStart = nowSeconds();
  let firstFrame;
  let lastFrame;
  let resolveFirstFrame;
  const firstFrameReady = new Promise((resolve) => {
    resolveFirstFrame = resolve;
  });
  const onFrame = (event) => {
    const timestamp = event.metadata?.timestamp;
    if (!Number.isFinite(timestamp)) return;
    if (firstFrame === undefined) {
      firstFrame = timestamp;
      resolveFirstFrame(timestamp);
    }
    lastFrame = timestamp;
  };
  client.on('Page.screencastFrame', onFrame);
  return {
    recordingStart,
    firstFrameReady,
    snapshot() {
      return { recordingStart, firstFrame, lastFrame };
    },
    dispose() {
      client.off('Page.screencastFrame', onFrame);
    },
  };
}

export function calculateEditorialTrim({
  recordingStart,
  firstFrame,
  lastFrame,
  jobStart,
  jobCompletion,
  recordingStop,
  rawDuration,
  plannedDuration,
  fps,
}) {
  for (const [name, value] of Object.entries({
    recordingStart,
    firstFrame,
    lastFrame,
    jobStart,
    jobCompletion,
    recordingStop,
    rawDuration,
    plannedDuration,
    fps,
  })) {
    if (!Number.isFinite(value))
      throw new Error(`Worldlayer: capture timing ${name} is unavailable.`);
  }
  if (plannedDuration <= 0 || rawDuration <= 0 || fps <= 0)
    throw new Error(
      'Worldlayer: capture timing durations and fps must be positive.',
    );
  if (
    firstFrame > jobStart ||
    jobStart > jobCompletion ||
    jobCompletion > recordingStop
  )
    throw new Error('Worldlayer: capture timing events are out of order.');
  const captureLead = jobStart - firstFrame;
  const startFrame = Math.max(0, Math.ceil(captureLead * fps - 1e-9));
  const frameCount = Math.max(1, Math.round(plannedDuration * fps));
  const endFrame = startFrame + frameCount;
  const rawFrameCount = Math.round(rawDuration * fps);
  if (endFrame > rawFrameCount)
    throw new Error(
      `Worldlayer: raw capture has ${rawFrameCount} frames but editorial trim needs ${endFrame}.`,
    );
  const finalDuration = frameCount / fps;
  return {
    recordingStart,
    firstFrame,
    lastFrame,
    jobStart,
    jobCompletion,
    recordingStop,
    rawDuration,
    plannedDuration,
    fps,
    captureLead,
    captureTail: Math.max(0, rawDuration - (jobCompletion - firstFrame)),
    trimStart: startFrame / fps,
    trimTail: Math.max(0, rawDuration - endFrame / fps),
    startFrame,
    endFrame,
    frameCount,
    finalDuration,
    durationDrift: finalDuration - plannedDuration,
    jobDuration: jobCompletion - jobStart,
  };
}

export function timingDrift(actualDuration, plannedDuration, fps) {
  const drift = actualDuration - plannedDuration;
  return { drift, withinOneFrame: Math.abs(drift) <= 1 / fps + 1e-6 };
}

export function formatTimingSummary(timing, actualDuration) {
  const { drift, withinOneFrame } = timingDrift(
    actualDuration,
    timing.plannedDuration,
    timing.fps,
  );
  const seconds = (value) => `${value.toFixed(3)}s`;
  return [
    'Worldlayer timing:',
    `planned: ${seconds(timing.plannedDuration)}`,
    `raw capture: ${seconds(timing.rawDuration)}`,
    `capture lead: ${seconds(timing.captureLead)}`,
    `capture tail: ${seconds(timing.captureTail)}`,
    `job execution: ${seconds(timing.jobDuration)}`,
    `trim: frame ${timing.startFrame} through ${timing.endFrame - 1}`,
    `final: ${seconds(actualDuration)}`,
    `drift: ${drift >= 0 ? '+' : ''}${seconds(drift)} (${withinOneFrame ? 'within one frame' : 'outside one frame'})`,
  ].join('\n');
}
