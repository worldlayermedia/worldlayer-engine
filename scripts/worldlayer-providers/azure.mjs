import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDotenvValue } from '../read-dotenv-value.mjs';
import { joinWavChunks, splitNarration } from './openai.mjs';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
export const DEFAULT_AZURE_VOICE = 'en-US-JennyNeural';
const OUTPUT_FORMAT = 'riff-24khz-16bit-mono-pcm';
const MAX_CHUNK_CHARACTERS = 1800;

function fail(message) {
  throw new Error(`Worldlayer: Azure narration ${message}`);
}

function setting(name, options) {
  return options.env === undefined
    ? process.env[name] || readDotenvValue(name, projectRoot)
    : options.env[name];
}

export function azureEndpoint(region) {
  const normalized =
    typeof region === 'string'
      ? region.trim().toLowerCase().replace(/\s+/g, '')
      : '';
  if (!/^[a-z][a-z0-9]{1,31}$/.test(normalized))
    fail('AZURE_SPEECH_REGION is invalid.');
  return `https://${normalized}.tts.speech.microsoft.com/cognitiveservices/v1`;
}

function escapeXml(value) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[character],
  );
}

function ssml(text, voice) {
  const language = voice.slice(0, 5);
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${language}"><voice name="${voice}">${escapeXml(text)}</voice></speak>`;
}

async function requestChunk(text, voice, context) {
  const { endpoint, apiKey, fetchImpl, wait, maxRetries } = context;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': apiKey,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': OUTPUT_FORMAT,
          'User-Agent': 'Worldlayer',
        },
        body: ssml(text, voice),
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      if (attempt < maxRetries) {
        await wait(300 * 2 ** attempt);
        continue;
      }
      fail('network request failed after bounded retries.');
    }
    if (response.ok) {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) fail('returned empty WAV audio.');
      return bytes;
    }
    if ([401, 403].includes(response.status))
      fail(
        `authentication failed (HTTP ${response.status}); check key and region.`,
      );
    if ([400, 404, 415, 422].includes(response.status))
      fail(`request or voice was rejected (HTTP ${response.status}).`);
    if (response.status === 429) {
      let message = '';
      try {
        message = String(await response.text()).slice(0, 1000);
      } catch {
        /* status remains available */
      }
      if (/quota|exhausted|insufficient credit/i.test(message))
        fail('provider quota is exhausted (HTTP 429).');
    }
    if (
      [408, 429, 500, 502, 503, 504].includes(response.status) &&
      attempt < maxRetries
    ) {
      await wait(300 * 2 ** attempt);
      continue;
    }
    fail(`provider request failed (HTTP ${response.status}).`);
  }
}

export async function generateNarration({
  text,
  voice,
  outputPath,
  options = {},
}) {
  const selectedVoice =
    voice || setting('WORLDLAYER_TTS_VOICE', options) || DEFAULT_AZURE_VOICE;
  if (
    typeof selectedVoice !== 'string' ||
    !/^[a-z]{2}-[A-Z]{2}-[A-Za-z0-9]+Neural$/.test(selectedVoice)
  )
    fail('voice must be a valid Azure neural voice name.');
  if (
    typeof outputPath !== 'string' ||
    !path.isAbsolute(outputPath) ||
    path.extname(outputPath).toLowerCase() !== '.wav'
  )
    fail('outputPath must be an absolute WAV path.');
  if (!fs.existsSync(path.dirname(outputPath)))
    fail('output directory does not exist.');
  if (fs.existsSync(outputPath) && !fs.lstatSync(outputPath).isFile())
    fail('outputPath must name a regular file.');
  let chunks;
  try {
    chunks = splitNarration(
      text,
      options.maxChunkCharacters ?? MAX_CHUNK_CHARACTERS,
    );
  } catch (error) {
    fail(error.message.replace(/^Worldlayer: OpenAI narration /, ''));
  }
  const apiKey = setting('AZURE_SPEECH_KEY', options);
  if (!apiKey?.trim()) fail('AZURE_SPEECH_KEY is required.');
  const region = setting('AZURE_SPEECH_REGION', options);
  if (!region?.trim()) fail('AZURE_SPEECH_REGION is required.');
  const endpoint = azureEndpoint(region);
  const maxRetries = options.maxRetries ?? 2;
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 3)
    fail('maxRetries must be between 0 and 3.');
  const context = {
    endpoint,
    apiKey,
    fetchImpl: options.fetchImpl ?? fetch,
    wait:
      options.wait ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    maxRetries,
  };
  console.log(
    `[Worldlayer] Azure narration: ${text.length} characters, ${chunks.length} chunk(s), voice ${selectedVoice}.`,
  );
  const buffers = [];
  for (const chunk of chunks)
    buffers.push(await requestChunk(chunk, selectedVoice, context));
  let audio;
  try {
    audio = joinWavChunks(buffers);
  } catch (error) {
    fail(error.message.replace(/^Worldlayer: OpenAI narration /, ''));
  }
  const temporary = `${outputPath}.tmp`;
  try {
    fs.writeFileSync(temporary, audio, { flag: 'wx' });
    fs.renameSync(temporary, outputPath);
  } catch (error) {
    if (fs.existsSync(temporary)) fs.rmSync(temporary);
    throw error;
  }
  return {
    path: outputPath,
    duration: audio.readUInt32LE(40) / audio.readUInt32LE(28),
    provider: 'azure',
    voice: selectedVoice,
    sampleRate: audio.readUInt32LE(24),
    channels: audio.readUInt16LE(22),
    chunkCount: chunks.length,
    characterCount: text.length,
    captionTimings: null,
  };
}
