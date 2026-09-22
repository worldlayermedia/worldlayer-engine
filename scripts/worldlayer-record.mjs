#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const BASE_URL =
  process.env.WORLDLAYER_BASE_URL || 'http://localhost:4173';

const output = path.resolve('renders');
fs.mkdirSync(output, { recursive: true });

const videoPath = path.join(output, 'worldlayer-mvp.webm');
const mp4Path = path.join(output, 'worldlayer-mvp.mp4');

function convertToMp4(input, output) {
  return new Promise((resolve, reject) => {
    console.log('[Worldlayer] Converting to MP4...');

    const ffmpeg = spawn(
      'ffmpeg',
      [
        '-y',
        '-i',
        input,
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
        output,
      ],
      {
        stdio: 'inherit',
      }
    );

    ffmpeg.on('error', reject);

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(`FFmpeg exited with code ${code}`)
        );
      }
    });
  });
}

console.log('[Worldlayer] Starting video recorder...');

const browser = await puppeteer.launch({
  headless: false,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--force-device-scale-factor=1',
    '--window-size=1920,1080',
  ],
});

const page = await browser.newPage();

try {
  await page.setViewport({
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
  });

  console.log('[Worldlayer] Opening God\'s Eye View...');

  await page.goto(`${BASE_URL}/?welcome=0`, {
    waitUntil: 'domcontentloaded',
  });

  console.log('[Worldlayer] Waiting for engine...');

  await page.waitForFunction(
    () =>
      window.__godsEyeView?.runVideoJob &&
      document
        .getElementById('loading-screen')
        ?.classList.contains('hidden'),
    {
      timeout: 60000,
    }
  );

  console.log('[Worldlayer] Engine ready.');
  console.log('[Worldlayer] Starting screencast...');

  const recorder = await page.screencast({
    path: videoPath,
  });

  console.log('[Worldlayer] Recording...');
  console.log('[Worldlayer] Running video job...');

  await page.evaluate(async () => {
    await window.__godsEyeView.runVideoJob();
  });

  console.log('[Worldlayer] Video job completed.');

  await new Promise((resolve) => setTimeout(resolve, 1000));

  await recorder.stop();

  console.log(`[Worldlayer] WebM saved: ${videoPath}`);

  await convertToMp4(videoPath, mp4Path);

  console.log(`[Worldlayer] MP4 saved: ${mp4Path}`);
} catch (error) {
  console.error('[Worldlayer] Recording failed:', error);
  process.exitCode = 1;
} finally {
  await browser.close();
}

console.log('[Worldlayer] Renderer finished.');