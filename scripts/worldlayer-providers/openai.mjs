import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDotenvValue } from '../read-dotenv-value.mjs';

const SPEECH_URL = 'https://api.openai.com/v1/audio/speech';
const MODEL = 'gpt-4o-mini-tts';
const MAX_CHUNK_CHARACTERS = 3800; // API maximum is 4096.
const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
export const OPENAI_VOICES = Object.freeze([
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'nova',
  'onyx',
  'sage',
  'shimmer',
  'verse',
  'marin',
  'cedar',
]);

function fail(message) {
  throw new Error(`Worldlayer: OpenAI narration ${message}`);
}

export function splitNarration(text, maxCharacters = MAX_CHUNK_CHARACTERS) {
  if (typeof text !== 'string' || !text.trim()) fail('text must be nonempty.');
  if (
    !Number.isInteger(maxCharacters) ||
    maxCharacters < 100 ||
    maxCharacters > 4096
  )
    fail('chunk size must be between 100 and 4096 characters.');
  const sentences = text
    .trim()
    .split(/(?:\n\s*\n|(?<=[.!?])\s+)/u)
    .filter(Boolean);
  const pieces = [];
  for (const sentence of sentences) {
    if (sentence.length <= maxCharacters) {
      pieces.push(sentence.trim());
      continue;
    }
    let part = '';
    for (const word of sentence.trim().split(/\s+/u)) {
      if (word.length > maxCharacters)
        fail('contains a word longer than the API input limit.');
      if (part && part.length + 1 + word.length > maxCharacters) {
        pieces.push(part);
        part = word;
      } else part = part ? `${part} ${word}` : word;
    }
    if (part) pieces.push(part);
  }
  const chunks = [];
  for (const piece of pieces) {
    const current = chunks.at(-1);
    if (current && current.length + 1 + piece.length <= maxCharacters)
      chunks[chunks.length - 1] = `${current} ${piece}`;
    else chunks.push(piece);
  }
  return chunks;
}

function wavParts(buffer) {
  if (
    !Buffer.isBuffer(buffer) ||
    buffer.length < 44 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WAVE'
  )
    fail('returned malformed WAV audio.');
  let format;
  let data;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const size = buffer.readUInt32LE(offset + 4);
    const end = offset + 8 + size;
    if (end > buffer.length) fail('returned malformed WAV audio.');
    const type = buffer.toString('ascii', offset, offset + 4);
    if (type === 'fmt ') {
      if (size < 16) fail('returned malformed WAV audio.');
      format = {
        encoding: buffer.readUInt16LE(offset + 8),
        channels: buffer.readUInt16LE(offset + 10),
        sampleRate: buffer.readUInt32LE(offset + 12),
        byteRate: buffer.readUInt32LE(offset + 16),
        blockAlign: buffer.readUInt16LE(offset + 20),
        bitsPerSample: buffer.readUInt16LE(offset + 22),
      };
    }
    if (type === 'data') data = buffer.subarray(offset + 8, end);
    offset = end + (size % 2);
  }
  if (
    !format ||
    !data?.length ||
    format.encoding !== 1 ||
    format.bitsPerSample !== 16 ||
    ![1, 2].includes(format.channels) ||
    !format.sampleRate ||
    data.length % format.blockAlign
  )
    fail('returned unsupported or empty WAV audio.');
  return { format, data };
}

export function joinWavChunks(buffers) {
  if (!Array.isArray(buffers) || !buffers.length)
    fail('returned no WAV chunks.');
  const parts = buffers.map(wavParts);
  const format = parts[0].format;
  if (
    parts.some((part) =>
      Object.keys(format).some((key) => part.format[key] !== format[key]),
    )
  )
    fail('returned incompatible WAV chunks.');
  const dataSize = parts.reduce((sum, part) => sum + part.data.length, 0);
  if (dataSize > 0xffffffff - 36)
    fail('generated WAV exceeds format size limit.');
  const output = Buffer.alloc(44 + dataSize);
  output.write('RIFF', 0);
  output.writeUInt32LE(36 + dataSize, 4);
  output.write('WAVEfmt ', 8);
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(format.channels, 22);
  output.writeUInt32LE(format.sampleRate, 24);
  output.writeUInt32LE(format.byteRate, 28);
  output.writeUInt16LE(format.blockAlign, 32);
  output.writeUInt16LE(16, 34);
  output.write('data', 36);
  output.writeUInt32LE(dataSize, 40);
  let offset = 44;
  for (const part of parts) {
    part.data.copy(output, offset);
    offset += part.data.length;
  }
  return output;
}

async function requestChunk(
  input,
  voice,
  { fetchImpl, apiKey, wait, maxRetries },
) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response;
    try {
      response = await fetchImpl(SPEECH_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          voice,
          input,
          response_format: 'wav',
        }),
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
      wavParts(bytes);
      return bytes;
    }
    if (response.status === 401 || response.status === 403)
      fail(`authentication failed (HTTP ${response.status}).`);
    if (response.status === 400 || response.status === 422)
      fail(`request or voice was rejected (HTTP ${response.status}).`);
    let errorCode = null;
    if (response.status === 429 && typeof response.json === 'function') {
      try {
        const reported = (await response.json())?.error?.code;
        if (typeof reported === 'string' && /^[a-z_]{1,64}$/i.test(reported))
          errorCode = reported;
      } catch {
        // A malformed error body must not hide the HTTP status.
      }
    }
    if (['insufficient_quota', 'credit_balance_exhausted'].includes(errorCode))
      fail(`provider quota is exhausted (HTTP 429, ${errorCode}).`);
    if (
      [408, 429, 500, 502, 503, 504].includes(response.status) &&
      attempt < maxRetries
    ) {
      await wait(300 * 2 ** attempt);
      continue;
    }
    fail(
      `provider request failed (HTTP ${response.status}${errorCode ? `, ${errorCode}` : ''}).`,
    );
  }
}

export async function generateNarration({
  text,
  voice,
  outputPath,
  options = {},
}) {
  if (!OPENAI_VOICES.includes(voice)) fail(`voice "${voice}" is unsupported.`);
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
  const chunks = splitNarration(text, options.maxChunkCharacters);
  const apiKey =
    options.env === undefined
      ? process.env.OPENAI_API_KEY ||
        readDotenvValue('OPENAI_API_KEY', projectRoot)
      : options.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) fail('OPENAI_API_KEY is required.');
  const fetchImpl = options.fetchImpl ?? fetch;
  const wait =
    options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const maxRetries = options.maxRetries ?? 2;
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 3)
    fail('maxRetries must be between 0 and 3.');
  console.log(
    `[Worldlayer] OpenAI narration: ${text.length} characters, ${chunks.length} chunk(s), voice ${voice}.`,
  );
  const buffers = [];
  for (const chunk of chunks)
    buffers.push(
      await requestChunk(chunk, voice, { fetchImpl, apiKey, wait, maxRetries }),
    );
  const audio = joinWavChunks(buffers);
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
    captionTimings: null,
    chunkCount: chunks.length,
    characterCount: text.length,
  };
}
