import fs from 'node:fs';
import path from 'node:path';
import { projectRoot } from './worldlayer-job-path.mjs';

const audioRoot = path.join(projectRoot, 'public', 'audio');

export function narrationConfig(job, root = audioRoot) {
  const file = job.audio?.narration?.file;
  if (file === undefined) return null;
  const relative = file.replace(/^\/audio\//, '');
  const candidate = path.resolve(root, relative);
  const within = (base, target) => {
    const relation = path.relative(base, target);
    return (
      relation &&
      relation !== '..' &&
      !relation.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relation)
    );
  };
  if (
    !/^\/audio\/[a-zA-Z0-9][a-zA-Z0-9._/-]*\.(wav|mp3)$/i.test(file) ||
    file.split('/').includes('..') ||
    !within(root, candidate)
  )
    throw new Error(
      'Worldlayer: narration path must be a WAV or MP3 inside public/audio.',
    );
  let realPath;
  try {
    realPath = fs.realpathSync(candidate);
  } catch (error) {
    if (error.code === 'ENOENT')
      throw new Error(`Worldlayer: narration file does not exist: ${file}`);
    throw error;
  }
  if (!within(fs.realpathSync(root), realPath))
    throw new Error('Worldlayer: narration path escapes public/audio.');
  if (!fs.statSync(realPath).isFile())
    throw new Error('Worldlayer: narration path must name a file.');
  return {
    filePath: realPath,
    extension: path.extname(realPath).toLowerCase(),
  };
}
