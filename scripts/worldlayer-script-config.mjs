import fs from 'node:fs';
import path from 'node:path';
import { projectRoot } from './worldlayer-job-path.mjs';

const defaultScriptRoot = path.join(projectRoot, 'public', 'scripts');

function within(base, candidate) {
  const relative = path.relative(base, candidate);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

export function loadNarrationScript(
  scriptFile,
  scriptRoot = defaultScriptRoot,
) {
  if (
    !/^\/scripts\/[a-zA-Z0-9][a-zA-Z0-9._/-]*\.txt$/i.test(scriptFile) ||
    scriptFile.split('/').includes('..')
  )
    throw new Error(
      'Worldlayer: narration.scriptFile must be a TXT path inside /scripts.',
    );
  const requested = path.resolve(
    scriptRoot,
    scriptFile.slice('/scripts/'.length),
  );
  if (!within(scriptRoot, requested))
    throw new Error('Worldlayer: narration.scriptFile escapes public/scripts.');
  let realPath;
  try {
    realPath = fs.realpathSync(requested);
  } catch (error) {
    if (error.code === 'ENOENT')
      throw new Error(
        `Worldlayer: narration script does not exist: ${scriptFile}`,
      );
    throw error;
  }
  if (!within(fs.realpathSync(scriptRoot), realPath))
    throw new Error('Worldlayer: narration.scriptFile escapes public/scripts.');
  if (!fs.statSync(realPath).isFile())
    throw new Error('Worldlayer: narration.scriptFile must name a file.');
  const text = fs.readFileSync(realPath, 'utf8').trim();
  if (!text)
    throw new Error(`Worldlayer: narration script is empty: ${scriptFile}`);
  return text;
}
