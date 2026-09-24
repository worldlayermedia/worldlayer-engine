import { analyzeScript } from './analyze-script.mjs';
import { VISUAL_INTENTS, templates, selectVisualIntent, sceneFromBeat } from './visual-templates.mjs';
import { validateVideoJob } from '../../src/video/jobValidation.js';

function fail(message) { throw new Error(`Worldlayer: ${message}`); }
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
}
function coordinate(value, label) {
  object(value, label);
  if (!Number.isFinite(value.longitude) || value.longitude < -180 || value.longitude > 180 || !Number.isFinite(value.latitude) || value.latitude < -90 || value.latitude > 90)
    fail(`${label} needs valid longitude and latitude.`);
}

export function validatePlanningJob(job) {
  object(job, 'planning job');
  if (job.version !== '0.2' || job.project !== 'worldlayer') fail('planning job needs Worldlayer version 0.2.');
  if (typeof job.title !== 'string' || !job.title.trim()) fail('planning job title is required.');
  object(job.output, 'output');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(job.output.filename ?? '') || job.output.filename === '..' || job.output.format !== 'mp4') fail('planning output needs a safe filename and mp4 format.');
  object(job.video, 'video');
  object(job.video.resolution, 'video.resolution');
  if (typeof job.video.format !== 'string' || !job.video.format || !Number.isInteger(job.video.resolution.width) || job.video.resolution.width < 1 || !Number.isInteger(job.video.resolution.height) || job.video.resolution.height < 1 || !Number.isFinite(job.video.fps) || job.video.fps <= 0) fail('planning video configuration is invalid.');
  object(job.planning, 'planning');
  if (job.scenes !== undefined) fail('planning jobs cannot define scenes.');
  const hasScriptFile = job.planning.scriptFile !== undefined;
  const hasScriptArtifact = job.planning.scriptArtifact !== undefined;
  if (hasScriptFile === hasScriptArtifact) fail('planning requires exactly one scriptFile or scriptArtifact.');
  if (hasScriptFile && (!/^\/scripts\/[a-zA-Z0-9][a-zA-Z0-9._/-]*\.txt$/i.test(job.planning.scriptFile) || job.planning.scriptFile.split('/').includes('..'))) fail('planning.scriptFile must be a TXT path inside /scripts.');
  if (hasScriptArtifact && (!/^renders\/scripts\/[a-zA-Z0-9][a-zA-Z0-9._-]*-script\.json$/.test(job.planning.scriptArtifact) || job.planning.scriptArtifact.split('/').includes('..'))) fail('planning.scriptArtifact must be a safe script artifact reference.');
  object(job.planning.locations, 'planning.locations');
  for (const [key, value] of Object.entries(job.planning.locations)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(key)) fail(`invalid location key "${key}".`);
    coordinate(value, `planning.locations.${key}`);
  }
  if (!Object.keys(job.planning.locations).length) fail('planning.locations needs at least one location for visual anchoring.');
  if (job.planning.defaultLocation !== undefined && !Object.hasOwn(job.planning.locations, job.planning.defaultLocation)) fail('planning.defaultLocation must name a known location.');
  for (const key of ['minimumSceneDuration', 'fixedIntroDuration', 'fixedOutroDuration'])
    if (job.planning[key] !== undefined && (!Number.isFinite(job.planning[key]) || job.planning[key] <= 0)) fail(`planning.${key} must be positive.`);
  if (job.planning.intentTemplates !== undefined) {
    object(job.planning.intentTemplates, 'planning.intentTemplates');
    for (const [intent, template] of Object.entries(job.planning.intentTemplates))
      if (!VISUAL_INTENTS.includes(intent) || !Object.hasOwn(templates, template)) fail(`unsupported intent or template: ${intent}/${template}.`);
  }
  object(job.narration, 'narration');
  if (typeof job.narration.provider !== 'string' || !job.narration.provider || typeof job.narration.voice !== 'string' || !job.narration.voice) fail('planning narration requires provider and voice.');
  if (job.narration.text !== undefined || job.narration.scriptFile !== undefined || job.audio !== undefined) fail('planning narration uses planning.scriptFile only.');
  if (job.captionMode !== undefined && job.captionMode !== 'script') fail('planning captionMode must be script.');
  if (job.captions !== undefined) fail('planning jobs cannot define manual captions.');
  return job;
}

export function validateScenePlan(plan) {
  object(plan, 'scene plan');
  if (plan.version !== '0.1' || typeof plan.title !== 'string' || !plan.title.trim()) fail('scene plan needs version 0.1 and title.');
  if (!Array.isArray(plan.beats) || !plan.beats.length) fail('scene plan needs beats.');
  let end = -1;
  const ids = new Set();
  for (const beat of plan.beats) {
    object(beat, 'beat');
    if (typeof beat.id !== 'string' || ids.has(beat.id)) fail('scene plan beat IDs must be unique.');
    ids.add(beat.id);
    if (typeof beat.text !== 'string' || !beat.text.trim() || !Number.isInteger(beat.startOffset) || !Number.isInteger(beat.endOffset) || beat.startOffset < end || beat.endOffset <= beat.startOffset) fail(`invalid beat text or offsets: ${beat.id}.`);
    end = beat.endOffset;
    if (!VISUAL_INTENTS.includes(beat.visualIntent) || !Object.hasOwn(templates, beat.template)) fail(`unsupported beat intent or template: ${beat.id}.`);
    if (!Number.isFinite(beat.weight) || beat.weight <= 0) fail(`invalid beat weight: ${beat.id}.`);
    if (!['resolved', 'fallback', 'unresolved'].includes(beat.resolution)) fail(`invalid location resolution: ${beat.id}.`);
    if (beat.location) coordinate(beat.location, `beat ${beat.id} location`);
  }
  return plan;
}

export function createScenePlan(job, script) {
  validatePlanningJob(job);
  const locations = job.planning.locations;
  const beats = analyzeScript(script).map((part, index) => {
    const explicit = Object.keys(locations).find((key) => new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(part.text));
    const locationKey = explicit ?? job.planning.defaultLocation ?? null;
    const resolution = explicit ? 'resolved' : locationKey ? 'fallback' : 'unresolved';
    const visualIntent = selectVisualIntent(part.text, explicit);
    return { id: `beat_${String(index + 1).padStart(2, '0')}`, ...part, visualIntent,
      locationKey, ...(locationKey ? { location: { ...locations[locationKey] } } : {}),
      priority: 1, weight: 1,
      template: job.planning.intentTemplates?.[visualIntent] ?? visualIntent,
      resolution };
  });
  return validateScenePlan({ version: '0.1', title: job.title, source: job.planning.scriptFile ? { scriptFile: job.planning.scriptFile } : { scriptArtifact: job.planning.scriptArtifact }, beats });
}

export function videoJobFromScenePlan(sourceJob, plan, { narrationText } = {}) {
  validatePlanningJob(sourceJob);
  validateScenePlan(plan);
  if (sourceJob.planning.scriptArtifact && (typeof narrationText !== 'string' || !narrationText.trim()))
    fail('planning.scriptArtifact requires narration text for video-job generation.');
  const anchor = Object.values(sourceJob.planning.locations)[0];
  const scenes = plan.beats.map((beat, index) => sceneFromBeat(beat, beat.location ?? anchor, index));
  if (sourceJob.planning.fixedIntroDuration !== undefined) scenes[0].timing = { mode: 'fixed', duration: sourceJob.planning.fixedIntroDuration };
  if (sourceJob.planning.fixedOutroDuration !== undefined) scenes.at(-1).timing = { mode: 'fixed', duration: sourceJob.planning.fixedOutroDuration };
  const job = {
    version: sourceJob.version, project: sourceJob.project, title: sourceJob.title,
    output: structuredClone(sourceJob.output), video: structuredClone(sourceJob.video), scenes,
    narration: { ...sourceJob.narration, ...(narrationText === undefined ? { scriptFile: sourceJob.planning.scriptFile } : { text: narrationText }) },
    ...(sourceJob.captionMode ? { captionMode: sourceJob.captionMode } : {}),
    timeline: { minimumSceneDuration: sourceJob.planning.minimumSceneDuration ?? 1 },
  };
  return validateVideoJob(job);
}
