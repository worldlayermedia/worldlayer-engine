import { easingFunctions } from './easing.js';
import { sceneMovements } from './movementList.js';

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
  if (job.audio !== undefined) {
    object(job.audio, 'audio');
    object(job.audio.narration, 'audio.narration');
    string(job.audio.narration.file, 'audio.narration.file');
    if (
      !/^\/audio\/[a-zA-Z0-9][a-zA-Z0-9._/-]*\.(wav|mp3)$/i.test(
        job.audio.narration.file,
      ) ||
      job.audio.narration.file.split('/').includes('..')
    )
      fail('audio.narration.file must be a WAV or MP3 path inside /audio.');
  }
  if (job.captions !== undefined) {
    if (!Array.isArray(job.captions)) fail('captions must be an array.');
    let previousEnd = 0;
    for (const [index, caption] of job.captions.entries()) {
      const captionPath = `captions[${index}]`;
      object(caption, captionPath);
      number(caption.start, `${captionPath}.start`, { min: 0 });
      number(caption.end, `${captionPath}.end`, { min: 0 });
      if (caption.end <= caption.start)
        fail(`${captionPath}.end must be after start.`);
      if (caption.start < previousEnd)
        fail(`${captionPath} overlaps or is out of order.`);
      string(caption.text, `${captionPath}.text`);
      previousEnd = caption.end;
    }
  }
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
    if (scene.movement !== undefined && scene.movements !== undefined)
      fail(`${path} cannot define both movement and movements.`);
    if (scene.movements !== undefined && !Array.isArray(scene.movements))
      fail(`${path}.movements must be an array.`);
    for (const [movementIndex, movement] of sceneMovements(scene).entries()) {
      const movementPath =
        scene.movements === undefined
          ? `${path}.movement`
          : `${path}.movements[${movementIndex}]`;
      object(movement, movementPath);
      if (!['orbit', 'pan', 'zoom', 'hold'].includes(movement.type))
        fail(`${movementPath}.type "${movement.type}" is unsupported.`);
      number(movement.duration, `${movementPath}.duration`, {
        min: Number.EPSILON,
      });
      if (
        movement.easing !== undefined &&
        !Object.hasOwn(easingFunctions, movement.easing)
      )
        fail(`${movementPath}.easing "${movement.easing}" is unsupported.`);
      if (movement.type === 'orbit') {
        number(movement.degrees, `${movementPath}.degrees`);
        if (movement.target !== undefined) {
          object(movement.target, `${movementPath}.target`);
          number(
            movement.target.longitude,
            `${movementPath}.target.longitude`,
            { min: -180, max: 180 },
          );
          number(movement.target.latitude, `${movementPath}.target.latitude`, {
            min: -90,
            max: 90,
          });
          if (movement.target.altitude !== undefined)
            number(
              movement.target.altitude,
              `${movementPath}.target.altitude`,
              { min: 0 },
            );
        }
      }
      if (movement.type === 'pan') {
        if (
          movement.horizontalMeters === undefined &&
          movement.verticalMeters === undefined
        )
          fail(`${movementPath} requires horizontalMeters or verticalMeters.`);
        for (const field of ['horizontalMeters', 'verticalMeters']) {
          if (movement[field] !== undefined)
            number(movement[field], `${movementPath}.${field}`);
        }
      }
      if (movement.type === 'zoom') {
        number(movement.factor, `${movementPath}.factor`, {
          min: Number.EPSILON,
        });
      }
    }
    const timed =
      scene.camera.flightDuration +
      sceneMovements(scene).reduce(
        (total, movement) => total + movement.duration,
        0,
      );
    if (timed > scene.duration + 1e-9)
      fail(`${path} timed operations exceed scene.duration.`);
  }
  const visualDuration = job.scenes.reduce(
    (total, scene) => total + scene.duration,
    0,
  );
  if (job.captions?.at(-1)?.end > visualDuration + 1e-9)
    fail('captions exceed the visual job duration.');
  return job;
}
