import fs from 'node:fs';
import path from 'node:path';
import { loadNarrationScript } from '../worldlayer-script-config.mjs';
import { createScenePlan, videoJobFromScenePlan } from './scene-plan.mjs';

export function prepareEditorialPlan(sourceJob, { outputDirectory, scriptRoot } = {}) {
  const script = loadNarrationScript(sourceJob.planning.scriptFile, scriptRoot);
  const plan = createScenePlan(sourceJob, script);
  const job = videoJobFromScenePlan(sourceJob, plan);
  const root = fs.realpathSync(outputDirectory);
  const directory = path.join(root, 'plans');
  fs.mkdirSync(directory, { recursive: true });
  if (path.relative(root, fs.realpathSync(directory)) !== 'plans')
    throw new Error('Worldlayer: scene plan output escapes renders.');
  const artifactPath = path.join(directory, `${job.output.filename}-scene-plan.json`);
  if (fs.existsSync(artifactPath) && !fs.lstatSync(artifactPath).isFile())
    throw new Error('Worldlayer: scene plan output must be a regular file.');
  fs.writeFileSync(artifactPath, `${JSON.stringify(plan, null, 2)}\n`);
  return { plan, job, artifactPath };
}
