import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { analyzeScript } from './analyze-script.mjs';
import { createScenePlan, validatePlanningJob, validateScenePlan, videoJobFromScenePlan } from './scene-plan.mjs';
import { templates, selectVisualIntent } from './visual-templates.mjs';
import { validateVideoJob } from '../../src/video/jobValidation.js';
import { resolveVideoTimeline } from '../../src/video/timelinePlanner.js';

const fixture = JSON.parse(fs.readFileSync(new URL('../../public/jobs/video-job-editorial.json', import.meta.url)));
const script = fs.readFileSync(new URL('../../public/scripts/toronto-story.txt', import.meta.url), 'utf8').trim();

test('paragraph and sentence segmentation preserves source order and offsets', () => {
  const source = 'A complete first paragraph with enough words to stand on its own.\n\nAnother complete paragraph has enough words for its own beat.';
  const beats = analyzeScript(source);
  assert.equal(beats.length, 2);
  for (const beat of beats) assert.equal(source.slice(beat.startOffset, beat.endOffset), beat.sourceText);
  assert.ok(beats[0].endOffset < beats[1].startOffset);
});

test('long sentences split and short sentences merge', () => {
  const source = `Brief. ${Array.from({ length: 85 }, (_, i) => `word${i}`).join(' ')}.`;
  const beats = analyzeScript(source);
  assert.ok(beats.length >= 2);
  assert.equal(beats[0].startOffset, 0);
  assert.equal(beats.at(-1).endOffset, source.length);
});

test('named locations resolve and unmatched text uses non-geographic intent', () => {
  const plan = createScenePlan(fixture, 'Toronto appears on the map with the waterfront and downtown clearly visible.\n\nA quiet thought about how people remember the past can stand alone without a named city.');
  assert.equal(plan.beats[0].locationKey, 'toronto');
  assert.equal(plan.beats[0].resolution, 'resolved');
  assert.equal(plan.beats[1].resolution, 'fallback');
  assert.equal(plan.beats[1].visualIntent, 'static_context');
  const noFallback = structuredClone(fixture);
  delete noFallback.planning.defaultLocation;
  assert.equal(createScenePlan(noFallback, 'A quiet thought about people remembering the past without any named city at all.').beats[0].resolution, 'unresolved');
});

test('intent and template vocabulary is deterministic', () => {
  assert.equal(selectVisualIntent('An orbit around the harbor', 'place'), 'orbit_location');
  assert.equal(selectVisualIntent('A route connects two districts', 'place'), 'route_overview');
  assert.equal(selectVisualIntent('This matters', null), 'static_context');
  assert.ok(Object.hasOwn(templates, 'orbit_location'));
  assert.deepEqual(createScenePlan(fixture, script), createScenePlan(fixture, script));
});

test('planning and scene-plan validation reject unsupported configuration', () => {
  const invalid = structuredClone(fixture);
  invalid.planning.locations.toronto.longitude = 200;
  assert.throws(() => validatePlanningJob(invalid), /Worldlayer.*longitude/);
  const invalidTemplate = structuredClone(fixture);
  invalidTemplate.planning.intentTemplates = { orbit_location: 'tracking' };
  assert.throws(() => validatePlanningJob(invalidTemplate), /unsupported intent or template/);
  const plan = createScenePlan(fixture, script);
  plan.beats[0].visualIntent = 'invented';
  assert.throws(() => validateScenePlan(plan), /unsupported beat/);
});

test('generated job validates and automatic timeline matches narration', () => {
  const plan = createScenePlan(fixture, script);
  const job = videoJobFromScenePlan(fixture, plan);
  validateVideoJob(job);
  assert.equal(job.scenes.length, plan.beats.length);
  assert.ok(job.scenes.every((scene) => scene.timing.mode === 'weighted'));
  const resolved = resolveVideoTimeline(job, { narrationDuration: 72, narrationText: script });
  assert.ok(Math.abs(resolved.timeline.totalVisualDuration - 72) < 0.001);
  assert.equal(resolved.timeline.scenes.length, plan.beats.length);
  assert.ok(resolved.timeline.captions.length > 0);
});
