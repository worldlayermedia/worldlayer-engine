#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const BASE_URL =
  process.env.WORLDLAYER_BASE_URL || 'http://localhost:4173';

const output = path.resolve('renders');

fs.mkdirSync(output, { recursive: true });

console.log('[Worldlayer] Starting renderer...');

const browser = await puppeteer.launch({
  headless: false,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const page = await browser.newPage();

try {
  await page.setViewport({
    width: 1920,
    height: 1080,
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

  await page.evaluate(() => {
    window.__worldlayerCompletedScenes = [];

    window.addEventListener(
      'worldlayer:scene-complete',
      (event) => {
        window.__worldlayerCompletedScenes.push(
          event.detail.id
        );
      }
    );
  });

  console.log('[Worldlayer] Running video job...');

  const jobPromise = page.evaluate(async () => {
    await window.__godsEyeView.runVideoJob();
  });

  for (const sceneId of [
    'scene_01',
    'scene_02',
    'scene_03',
  ]) {
    await page.waitForFunction(
      (id) =>
        window.__worldlayerCompletedScenes?.includes(id),
      {
        timeout: 30000,
      },
      sceneId
    );

    const filename = path.join(
      output,
      `${sceneId}.png`
    );

    await page.screenshot({
      path: filename,
    });

    console.log(
      `[Worldlayer] Captured ${sceneId}.png`
    );
  }

  await jobPromise;

  console.log('[Worldlayer] Video job completed.');
} catch (error) {
  console.error('[Worldlayer] Render failed:', error);
  process.exitCode = 1;
} finally {
  await browser.close();
}

console.log('[Worldlayer] Renderer finished.');