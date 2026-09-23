import path from 'node:path';
import { validateVideoJob } from '../src/video/jobValidation.js';

export function recordConfig(job, outputDirectory = path.resolve('renders')) {
  validateVideoJob(job);
  const { width, height } = job.video.resolution;
  const { fps } = job.video;
  const filename = job.output.filename;
  const mp4Path = path.resolve(
    outputDirectory,
    `${filename}.${job.output.format}`,
  );
  const webmPath = path.resolve(outputDirectory, `${filename}.webm`);
  const relativeMp4 = path.relative(outputDirectory, mp4Path);
  const relativeWebm = path.relative(outputDirectory, webmPath);
  if (
    [relativeMp4, relativeWebm].some(
      (relative) => relative.startsWith('..') || path.isAbsolute(relative),
    )
  ) {
    throw new Error(
      'Worldlayer: output.filename escapes the render directory.',
    );
  }
  const durationMs = Math.ceil(
    job.scenes.reduce((total, scene) => total + scene.duration, 0) * 1000,
  );
  return {
    width,
    height,
    fps,
    webmPath,
    mp4Path,
    jobTimeoutMs: durationMs + 60_000,
    ffmpegTimeoutMs: Math.max(120_000, durationMs * 10),
  };
}
