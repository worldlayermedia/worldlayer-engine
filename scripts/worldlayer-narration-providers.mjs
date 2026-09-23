import { generateNarration as generateMockNarration } from './worldlayer-providers/mock.mjs';

const providers = Object.freeze({ mock: generateMockNarration });

export async function generateNarration({
  provider,
  text,
  voice,
  outputPath,
  options,
}) {
  const implementation = providers[provider];
  if (!implementation)
    throw new Error(
      `Worldlayer: narration provider "${provider}" is unsupported.`,
    );
  return implementation({ text, voice, outputPath, options });
}
