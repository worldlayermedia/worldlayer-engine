import { generateNarration as generateMockNarration } from './worldlayer-providers/mock.mjs';
import { generateNarration as generateOpenAINarration } from './worldlayer-providers/openai.mjs';
import { generateNarration as generateAzureNarration } from './worldlayer-providers/azure.mjs';

const providers = Object.freeze({ mock: generateMockNarration, openai: generateOpenAINarration, azure: generateAzureNarration });

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
