#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';
import { recordConfig } from './worldlayer-record-config.mjs';
import { loadRenderJob, projectRoot } from './worldlayer-job-path.mjs';

const VITE_STARTUP_TIMEOUT_MS = 30_000;
const ENGINE_READY_TIMEOUT_MS = 60_000;
const FFMPEG_STOP_TIMEOUT_MS = 30_000;
const DEFAULT_JOB_PATH = 'public/jobs/video-job.json';
const viteCli = path.join(
  projectRoot,
  'node_modules',
  'vite',
  'bin',
  'vite.js',
);
const output = path.join(projectRoot, 'renders');

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function withTimeout(promise, milliseconds, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `Worldlayer: ${label} timed out after ${milliseconds}ms.`,
            ),
          ),
        milliseconds,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startVite(jobUrl) {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const vite = spawn(
    process.execPath,
    [viteCli, '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: projectRoot,
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let startupError;
  let logTail = '';
  vite.on('error', (error) => {
    startupError = error;
  });
  for (const stream of [vite.stdout, vite.stderr]) {
    stream.on('data', (chunk) => {
      logTail = (logTail + chunk.toString()).slice(-2000);
    });
  }

  try {
    const deadline = Date.now() + VITE_STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (startupError)
        throw new Error(
          `Worldlayer: Vite failed to start: ${startupError.message}`,
        );
      if (vite.exitCode !== null || vite.signalCode !== null) {
        throw new Error(
          `Worldlayer: Vite exited during startup (${vite.exitCode ?? vite.signalCode}). ${logTail.trim()}`,
        );
      }
      try {
        const response = await fetch(baseUrl + jobUrl, {
          signal: AbortSignal.timeout(1000),
        });
        if (
          response.ok &&
          response.headers.get('content-type')?.includes('json')
        ) {
          return { vite, baseUrl };
        }
      } catch {
        /* The socket is expected to refuse connections until Vite listens. */
      }
      await delay(200);
    }
    throw new Error(
      `Worldlayer: Vite startup timed out after ${VITE_STARTUP_TIMEOUT_MS}ms. ${logTail.trim()}`,
    );
  } catch (error) {
    await stopVite(vite);
    throw error;
  }
}

async function stopVite(vite) {
  if (!vite || vite.exitCode !== null || vite.signalCode !== null) return;
  const waitForExit = (milliseconds) =>
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), milliseconds);
      vite.once('exit', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  vite.kill('SIGTERM');
  if (
    !(await waitForExit(5000)) &&
    vite.exitCode === null &&
    vite.signalCode === null
  ) {
    vite.kill('SIGKILL');
    if (!(await waitForExit(5000)))
      throw new Error('Worldlayer: Vite did not stop.');
  }
}

function convertToMp4(input, outputPath, fps, timeoutMs) {
  return new Promise((resolve, reject) => {
    console.log('[Worldlayer] Converting to MP4...');

    const ffmpeg = spawn(
      'ffmpeg',
      [
        '-y',
        '-i',
        input,
        '-r',
        String(fps),
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
        '-an',
        outputPath,
      ],
      {
        stdio: 'inherit',
      },
    );

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ffmpeg.kill('SIGKILL');
    }, timeoutMs);
    ffmpeg.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    ffmpeg.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut)
        reject(new Error(`Worldlayer: FFmpeg timed out after ${timeoutMs}ms.`));
      else if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Worldlayer: FFmpeg exited with code ${code}.`));
      }
    });
  });
}

console.log('[Worldlayer] Starting video recorder...');
let vite;
let browser;
let recorder;
try {
  if (process.argv.length > 3)
    throw new Error('Worldlayer: provide at most one job path.');
  const { job, jobUrl } = loadRenderJob(process.argv[2] || DEFAULT_JOB_PATH);
  const config = recordConfig(job, output);
  fs.mkdirSync(output, { recursive: true });

  console.log('[Worldlayer] Starting local Vite server...');
  ({ vite, baseUrl: config.baseUrl } = await startVite(jobUrl));
  console.log(`[Worldlayer] Vite ready at ${config.baseUrl}`);

  browser = await puppeteer.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--force-device-scale-factor=1',
      `--window-size=${config.width},${config.height}`,
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({
    width: config.width,
    height: config.height,
    deviceScaleFactor: 1,
  });
  console.log("[Worldlayer] Opening God's Eye View...");
  await page.goto(`${config.baseUrl}/?welcome=0`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  console.log('[Worldlayer] Waiting for engine...');
  await page.waitForFunction(
    () =>
      window.__godsEyeView?.runVideoJob &&
      document.getElementById('loading-screen')?.classList.contains('hidden'),
    { timeout: ENGINE_READY_TIMEOUT_MS },
  );

  const servedJob = await page.evaluate(async (url) => {
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(
        `Worldlayer: failed to load video job (${response.status}).`,
      );
    return response.json();
  }, jobUrl);
  if (JSON.stringify(servedJob) !== JSON.stringify(job)) {
    throw new Error(
      'Worldlayer: job changed between validation and browser load.',
    );
  }
  console.log('[Worldlayer] Engine ready.');
  console.log('[Worldlayer] Starting screencast...');
  recorder = await page.screencast({
    path: config.webmPath,
    fps: config.fps,
  });

  console.log('[Worldlayer] Recording...');
  console.log('[Worldlayer] Running video job...');

  await withTimeout(
    page.evaluate((url) => window.__godsEyeView.runVideoJob(url), jobUrl),
    config.jobTimeoutMs,
    'video job',
  );

  console.log('[Worldlayer] Video job completed.');

  await new Promise((resolve) => setTimeout(resolve, 1000));

  await withTimeout(recorder.stop(), FFMPEG_STOP_TIMEOUT_MS, 'recording stop');
  recorder = undefined;

  console.log(`[Worldlayer] WebM saved: ${config.webmPath}`);

  await convertToMp4(
    config.webmPath,
    config.mp4Path,
    config.fps,
    config.ffmpegTimeoutMs,
  );
  const mp4 = fs.existsSync(config.mp4Path)
    ? fs.statSync(config.mp4Path)
    : null;
  if (!mp4?.isFile() || mp4.size === 0)
    throw new Error('Worldlayer: MP4 output is missing or empty.');

  console.log(`[Worldlayer] MP4 saved: ${config.mp4Path}`);
} catch (error) {
  console.error('[Worldlayer] Recording failed:', error);
  process.exitCode = 1;
} finally {
  try {
    if (recorder)
      await withTimeout(
        recorder.stop(),
        FFMPEG_STOP_TIMEOUT_MS,
        'recording stop',
      );
  } catch (error) {
    console.error('[Worldlayer] Failed to stop recorder:', error);
    process.exitCode = 1;
  }
  try {
    if (browser) await withTimeout(browser.close(), 10_000, 'browser close');
  } catch (error) {
    console.error('[Worldlayer] Failed to close browser:', error);
    process.exitCode = 1;
  }
  try {
    await stopVite(vite);
  } catch (error) {
    console.error('[Worldlayer] Failed to stop Vite:', error);
    process.exitCode = 1;
  }
}

console.log('[Worldlayer] Renderer finished.');
