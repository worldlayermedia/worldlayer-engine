function fail(message) {
  throw new Error(`Worldlayer: ${message}`);
}

function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail(`${path} must be an object.`);
}

function string(value, path) {
  if (typeof value !== 'string' || !value.trim())
    fail(`${path} must be a nonempty string.`);
}

function number(
  value,
  path,
  { min = -Infinity, max = Infinity, integer = false } = {},
) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  ) {
    fail(
      `${path} must be a ${integer ? 'whole ' : ''}number between ${min} and ${max}.`,
    );
  }
}

export function validateVideoJob(job) {
  object(job, 'job');
  if (job.version !== '0.2') fail('version must be "0.2".');
  if (job.project !== 'worldlayer') fail('project must be "worldlayer".');
  string(job.title, 'title');
  object(job.output, 'output');
  string(job.output.filename, 'output.filename');
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(job.output.filename) ||
    job.output.filename === '..'
  ) {
    fail('output.filename must be a safe file stem.');
  }
  if (job.output.format !== 'mp4') fail('output.format must be "mp4".');
  object(job.video, 'video');
  string(job.video.format, 'video.format');
  object(job.video.resolution, 'video.resolution');
  number(job.video.resolution.width, 'video.resolution.width', {
    min: 1,
    integer: true,
  });
  number(job.video.resolution.height, 'video.resolution.height', {
    min: 1,
    integer: true,
  });
  number(job.video.fps, 'video.fps', { min: 1 });
  if (!Array.isArray(job.scenes) || job.scenes.length === 0)
    fail('scenes must be a nonempty array.');

  const ids = new Set();
  for (const [index, scene] of job.scenes.entries()) {
    const path = `scenes[${index}]`;
    object(scene, path);
    string(scene.id, `${path}.id`);
    if (ids.has(scene.id)) fail(`duplicate scene id "${scene.id}".`);
    ids.add(scene.id);
    string(scene.name, `${path}.name`);
    number(scene.duration, `${path}.duration`, { min: Number.EPSILON });
    object(scene.camera, `${path}.camera`);
    number(scene.camera.longitude, `${path}.camera.longitude`, {
      min: -180,
      max: 180,
    });
    number(scene.camera.latitude, `${path}.camera.latitude`, {
      min: -90,
      max: 90,
    });
    number(scene.camera.altitude, `${path}.camera.altitude`, { min: 0 });
    number(scene.camera.flightDuration, `${path}.camera.flightDuration`, {
      min: 0,
    });
    for (const field of ['heading', 'pitch', 'roll']) {
      if (scene.camera[field] !== undefined)
        number(scene.camera[field], `${path}.camera.${field}`);
    }
    if (scene.movement !== undefined) {
      object(scene.movement, `${path}.movement`);
      if (scene.movement.type !== 'orbit')
        fail(`${path}.movement.type "${scene.movement.type}" is unsupported.`);
      number(scene.movement.duration, `${path}.movement.duration`, {
        min: Number.EPSILON,
      });
      number(scene.movement.degrees, `${path}.movement.degrees`);
    }
    const timed = scene.camera.flightDuration + (scene.movement?.duration ?? 0);
    if (timed > scene.duration + 1e-9)
      fail(`${path} timed operations exceed scene.duration.`);
  }
  return job;
}
