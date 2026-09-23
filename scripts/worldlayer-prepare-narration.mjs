import fs from 'node:fs';
import path from 'node:path';
import { validateVideoJob } from '../src/video/jobValidation.js';
import { narrationConfig } from './worldlayer-audio-config.mjs';
import { loadNarrationScript } from './worldlayer-script-config.mjs';
import { generateNarration } from './worldlayer-narration-providers.mjs';
import { mediaDuration } from './worldlayer-media-assembly.mjs';
import { projectRoot } from './worldlayer-job-path.mjs';

export async function prepareNarration(
  job,
  {
    outputDirectory = path.join(projectRoot, 'renders'),
    scriptRoot,
    audioRoot,
    durationProbe = mediaDuration,
    generate = generateNarration,
    probeTimeoutMs = 30_000,
  } = {},
) {
  validateVideoJob(job);
  const requiresPlanning = job.scenes.some(
    (scene) => scene.timing !== undefined || scene.duration === undefined,
  );
  const visualDuration = requiresPlanning
    ? null
    : job.scenes.reduce((total, scene) => total + scene.duration, 0);
  if (job.audio?.narration) {
    const existing = narrationConfig(job, audioRoot);
    const duration = await durationProbe(existing.filePath, probeTimeoutMs);
    return {
      path: existing.filePath,
      filePath: existing.filePath,
      duration,
      provider: 'file',
      voice: null,
      captionTimings: null,
    };
  }
  if (!job.narration) return null;
  const { provider, voice } = job.narration;
  const text =
    job.narration.text ??
    loadNarrationScript(job.narration.scriptFile, scriptRoot);
  const generatedDirectory = path.resolve(outputDirectory, 'audio');
  const relative = path.relative(outputDirectory, generatedDirectory);
  if (relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error(
      'Worldlayer: generated audio path escapes render directory.',
    );
  fs.mkdirSync(generatedDirectory, { recursive: true });
  const realRelative = path.relative(
    fs.realpathSync(outputDirectory),
    fs.realpathSync(generatedDirectory),
  );
  if (
    !realRelative ||
    realRelative === '..' ||
    realRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(realRelative)
  )
    throw new Error(
      'Worldlayer: generated audio path escapes render directory.',
    );
  const outputPath = path.join(
    generatedDirectory,
    `${job.output.filename}-narration.wav`,
  );
  try {
    if (!fs.lstatSync(outputPath).isFile())
      throw new Error(
        'Worldlayer: generated audio output must be a regular file.',
      );
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const result = await generate({
    provider,
    text,
    voice,
    outputPath,
    options: {},
  });
  if (
    !result ||
    result.path !== outputPath ||
    !fs.existsSync(outputPath) ||
    !fs.statSync(outputPath).isFile()
  )
    throw new Error(
      'Worldlayer: narration provider did not produce the requested audio file.',
    );
  const duration = await durationProbe(outputPath, probeTimeoutMs);
  if (!Number.isFinite(duration) || duration <= 0)
    throw new Error('Worldlayer: generated narration duration is invalid.');
  if (visualDuration !== null && duration > visualDuration + 1e-9)
    throw new Error(
      `Worldlayer: generated narration duration ${duration.toFixed(2)}s exceeds visual duration ${visualDuration.toFixed(2)}s by ${(duration - visualDuration).toFixed(2)}s.`,
    );
  return {
    path: outputPath,
    filePath: outputPath,
    duration,
    provider,
    voice,
    text,
    captionTimings: result.captionTimings ?? null,
  };
}
