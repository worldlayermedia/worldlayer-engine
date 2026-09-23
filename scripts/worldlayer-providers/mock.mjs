import fs from 'node:fs';

const SAMPLE_RATE = 16_000;
const SECONDS_PER_WORD = 0.3;

/** Deterministic diagnostic tones; this mock does not produce spoken words. */
export async function generateNarration({
  text,
  voice,
  outputPath,
  options = {},
}) {
  if (voice !== 'default')
    throw new Error(
      `Worldlayer: mock narration voice "${voice}" is unsupported.`,
    );
  const words = text.trim().split(/\s+/);
  const secondsPerWord = options.secondsPerWord ?? SECONDS_PER_WORD;
  if (!Number.isFinite(secondsPerWord) || secondsPerWord <= 0)
    throw new Error('Worldlayer: mock secondsPerWord must be positive.');
  const sampleCount = Math.max(
    1,
    Math.round(words.length * secondsPerWord * SAMPLE_RATE),
  );
  const dataSize = sampleCount * 2;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(SAMPLE_RATE * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(dataSize, 40);
  const samplesPerWord = secondsPerWord * SAMPLE_RATE;
  for (let index = 0; index < sampleCount; index++) {
    const position = (index % samplesPerWord) / SAMPLE_RATE;
    const tone =
      position < secondsPerWord * 0.55
        ? Math.sin((2 * Math.PI * 330 * index) / SAMPLE_RATE) * 0.12
        : 0;
    wav.writeInt16LE(Math.round(tone * 32767), 44 + index * 2);
  }
  fs.writeFileSync(outputPath, wav);
  return { path: outputPath, captionTimings: null };
}
