import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateVideoJob } from '../src/video/jobValidation.js';
import { validatePlanningJob } from './worldlayer-editorial/scene-plan.mjs';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const jobsRoot = path.join(projectRoot, 'public', 'jobs');
const preparedRoot = path.join(projectRoot, 'renders', 'plans');

function isWithin(directory, candidate) {
  const relative = path.relative(directory, candidate);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

export function loadRenderJob(argument = 'public/jobs/video-job.json') {
  const requested = path.resolve(projectRoot, argument);
  const prepared = isWithin(preparedRoot, requested);
  const root = prepared ? preparedRoot : jobsRoot;
  if (
    !isWithin(root, requested) ||
    path.extname(requested).toLowerCase() !== '.json'
  ) {
    throw new Error(
      'Worldlayer: job path must be a JSON file inside public/jobs or renders/plans.',
    );
  }

  let realPath;
  try {
    realPath = fs.realpathSync(requested);
  } catch (error) {
    if (error.code === 'ENOENT')
      throw new Error(`Worldlayer: job file does not exist: ${argument}`);
    throw error;
  }
  if (!isWithin(fs.realpathSync(root), realPath)) {
    throw new Error('Worldlayer: job path escapes its allowed directory.');
  }

  let job;
  try {
    job = JSON.parse(fs.readFileSync(realPath, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error(`Worldlayer: invalid job JSON: ${error.message}`);
    throw error;
  }
  if (job.planning !== undefined) validatePlanningJob(job);
  else validateVideoJob(job);

  const relative = path.relative(jobsRoot, realPath);
  const jobUrl = prepared ? null : `/jobs/${relative.split(path.sep).map(encodeURIComponent).join('/')}`;
  return { job, jobUrl, filePath: realPath };
}
