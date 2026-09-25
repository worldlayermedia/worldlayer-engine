import { generateText as generateOpenRouterText } from './openrouter.mjs';

const providers = Object.freeze({ openrouter: generateOpenRouterText });

export async function generateText({ provider, ...request }) {
  if (!Object.hasOwn(providers, provider))
    throw new Error(`Worldlayer: LLM provider ${provider} is unsupported.`);
  return providers[provider](request);
}
