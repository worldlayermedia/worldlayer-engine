import { generateText } from '../worldlayer-llm/providers.mjs';
import {
  claimBatches,
  scriptMessages,
  SCRIPT_PROMPT_VERSION,
} from './script-prompt.mjs';

function fail(message) {
  throw new Error(`Worldlayer: OpenRouter script ${message}`);
}

function parseSections(text) {
  const trimmed = text.trim();
  const json =
    trimmed.startsWith('```json') && trimmed.endsWith('```')
      ? trimmed.slice(7, -3).trim()
      : trimmed;
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    fail('response is not valid JSON.');
  }
  if (!parsed || !Array.isArray(parsed.sections) || !parsed.sections.length)
    fail('response needs a nonempty sections array.');
  return parsed.sections;
}

export async function generateOpenRouterScript({
  brief,
  packet,
  claims,
  model,
  options = {},
}) {
  const batches = claimBatches(claims);
  const sections = [];
  let resolvedModel;
  let requestedModel;
  const usage = [];
  for (const [batchIndex, batch] of batches.entries()) {
    const reply = await generateText({
      provider: 'openrouter',
      model,
      messages: scriptMessages({
        brief,
        claims: batch,
        batchIndex,
        batchCount: batches.length,
      }),
      temperature: 0.1,
      maxTokens: 4000,
      metadata: { promptVersion: SCRIPT_PROMPT_VERSION },
      options: options.llm ?? {},
    });
    if (reply.finishReason === 'length')
      fail('response was truncated by the model.');
    if (resolvedModel && reply.model !== resolvedModel)
      fail('resolved model changed between script batches.');
    resolvedModel = reply.model;
    requestedModel = reply.requestedModel;
    if (reply.usage) usage.push(reply.usage);
    const allowed = new Map(batch.map((claim, index) => [claim.id, index]));
    let highestFirstCitation = -1;
    const seen = new Set();
    for (const section of parseSections(reply.text)) {
      if (
        !section ||
        typeof section.text !== 'string' ||
        !section.text.trim() ||
        !Array.isArray(section.claimIds) ||
        !section.claimIds.length
      )
        fail('section has invalid text or claim references.');
      const ids = [...new Set(section.claimIds)];
      if (ids.some((id) => !allowed.has(id)))
        fail('section references a claim outside its approved batch.');
      for (const id of ids) {
        const position = allowed.get(id);
        if (!seen.has(id) && position < highestFirstCitation)
          fail('section claim order does not match approved source order.');
        seen.add(id);
        highestFirstCitation = Math.max(highestFirstCitation, position);
      }
      const claimText = ids.map((id) => batch[allowed.get(id)].text).join(' ');
      for (const number of section.text.match(
        /\b\d+(?:[.,]\d+)*(?:%|st|nd|rd|th)?\b/g,
      ) ?? [])
        if (!claimText.includes(number))
          fail(`section introduces unsupported numeric detail ${number}.`);
      sections.push({
        id: `section_${String(sections.length + 1).padStart(2, '0')}`,
        text: section.text.trim(),
        claimIds: ids,
      });
    }
  }
  return {
    version: '0.1',
    title: brief.title,
    text: sections.map((section) => section.text).join('\n\n'),
    sections,
    provenance: {
      provider: 'openrouter',
      researchProvider: packet.provenance.provider,
    },
    generation: {
      provider: 'openrouter',
      model: resolvedModel,
      requestedModel,
      promptVersion: SCRIPT_PROMPT_VERSION,
      generatedAt: (options.now ?? (() => new Date()))().toISOString(),
      requestCount: batches.length,
      usage: usage.length ? usage : null,
    },
  };
}
