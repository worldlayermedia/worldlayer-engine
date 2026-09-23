import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { captionedFilename, captionsToSrt } from './worldlayer-captions.mjs';
import { projectRoot } from './worldlayer-job-path.mjs';

export function runMediaTool(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let stdout = '';
    let timedOut = false;
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`Worldlayer: ${command} failed: ${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut)
        reject(
          new Error(`Worldlayer: ${command} timed out after ${timeoutMs}ms.`),
        );
      else if (code === 0) resolve(stdout);
      else
        reject(
          new Error(
            `Worldlayer: ${command} exited with code ${code}. ${stderr}`,
          ),
        );
    });
  });
}

export async function mediaDuration(filePath, timeoutMs) {
  const result = await runMediaTool(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ],
    timeoutMs,
  );
  let duration = Number(result.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    const packets = await runMediaTool(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'packet=pts_time,duration_time',
        '-of',
        'csv=p=0',
        filePath,
      ],
      timeoutMs,
    );
    duration = packetDuration(packets);
  }
  if (!Number.isFinite(duration) || duration <= 0)
    throw new Error(`Worldlayer: cannot determine media duration: ${filePath}`);
  return duration;
}

export function packetDuration(packets) {
  let end = 0;
  for (const line of packets.trim().split(/\r?\n/)) {
    const [timestamp, length] = line.split(',').map(Number);
    if (Number.isFinite(timestamp))
      end = Math.max(end, timestamp + (Number.isFinite(length) ? length : 0));
  }
  return end;
}

function verifyFile(filePath) {
  const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
  if (!stat?.isFile() || stat.size === 0)
    throw new Error(
      `Worldlayer: media output is missing or empty: ${filePath}`,
    );
}

export function assertNarrationFits(
  audioDuration,
  visualDuration,
  toleranceSeconds = 0.5,
) {
  if (audioDuration > visualDuration + toleranceSeconds)
    throw new Error(
      `Worldlayer: narration duration ${audioDuration.toFixed(2)}s exceeds rendered video ${visualDuration.toFixed(2)}s by more than ${toleranceSeconds}s.`,
    );
}

export async function assembleMedia({
  job,
  config,
  narration,
  narrationToleranceSeconds = 0.5,
}) {
  const visualDuration = await mediaDuration(
    config.webmPath,
    config.ffmpegTimeoutMs,
  );
  if (narration) {
    const audioDuration = await mediaDuration(
      narration.filePath,
      config.ffmpegTimeoutMs,
    );
    assertNarrationFits(
      audioDuration,
      visualDuration,
      narrationToleranceSeconds,
    );
  }
  const videoArgs = ['-y', '-i', config.webmPath];
  if (narration) videoArgs.push('-i', narration.filePath);
  videoArgs.push('-map', '0:v:0');
  if (narration) videoArgs.push('-map', '1:a:0');
  videoArgs.push(
    '-r',
    String(config.fps),
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
  );
  if (narration)
    videoArgs.push('-c:a', 'aac', '-b:a', '192k', '-af', 'apad', '-shortest');
  else videoArgs.push('-an');
  videoArgs.push(config.mp4Path);
  await runMediaTool('ffmpeg', videoArgs, config.ffmpegTimeoutMs);
  verifyFile(config.mp4Path);

  if (!job.captions?.length) return { mp4Path: config.mp4Path };
  const srtPath = path.join(
    path.dirname(config.mp4Path),
    `${job.output.filename}.srt`,
  );
  const captionedPath = path.join(
    path.dirname(config.mp4Path),
    captionedFilename(job.output.filename),
  );
  if (job.captions.at(-1).end > visualDuration + 1e-9)
    throw new Error('Worldlayer: captions exceed the rendered video duration.');
  fs.writeFileSync(srtPath, captionsToSrt(job.captions), 'utf8');
  const relativeSrt = path
    .relative(projectRoot, srtPath)
    .split(path.sep)
    .join('/');
  if (
    relativeSrt.startsWith('../') ||
    relativeSrt.includes(':') ||
    relativeSrt.includes("'")
  )
    throw new Error('Worldlayer: caption path must be inside the project.');
  await runMediaTool(
    'ffmpeg',
    [
      '-y',
      '-i',
      config.mp4Path,
      '-vf',
      `subtitles=filename=${relativeSrt}`,
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'copy',
      '-movflags',
      '+faststart',
      captionedPath,
    ],
    config.ffmpegTimeoutMs,
  );
  verifyFile(captionedPath);
  return { mp4Path: config.mp4Path, captionedPath, srtPath };
}
