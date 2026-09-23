import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadRenderJob,
  projectRoot,
} from '../../scripts/worldlayer-job-path.mjs';

test('default and explicit job paths resolve to the same served job', () => {
  const defaultJob = loadRenderJob();
  const explicitJob = loadRenderJob('public/jobs/video-job.json');
  assert.equal(defaultJob.jobUrl, '/jobs/video-job.json');
  assert.equal(explicitJob.filePath, defaultJob.filePath);
  assert.equal(explicitJob.job.title, defaultJob.job.title);
  assert.ok(defaultJob.filePath.startsWith(projectRoot));
});

test('job paths outside public/jobs are rejected', () => {
  assert.throws(() => loadRenderJob('package.json'), /Worldlayer: job path/);
  assert.throws(
    () => loadRenderJob('public/jobs/../../package.json'),
    /Worldlayer: job path/,
  );
});

test('missing job files fail before starting Vite', () => {
  assert.throws(
    () => loadRenderJob('public/jobs/does-not-exist.json'),
    /Worldlayer: job file does not exist/,
  );
});
