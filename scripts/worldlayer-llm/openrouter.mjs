import { fileURLToPath } from 'node:url';
import { readDotenvValue } from '../read-dotenv-value.mjs';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
export const DEFAULT_FREE_MODEL = 'nex-agi/nex-n2.5-mini:free';

function fail(message) {
  throw new Error(`Worldlayer: OpenRouter ${message}`);
}

export function selectedModel(model, environment = process.env) {
  const value =
    model ||
    environment.WORLDLAYER_LLM_MODEL ||
    (environment === process.env
      ? readDotenvValue('WORLDLAYER_LLM_MODEL', projectRoot)
      : '') ||
    DEFAULT_FREE_MODEL;
  if (typeof value !== 'string' || !value.trim()) fail('model ID is required.');
  const selected = value.trim();
  if (
    selected !== 'openrouter/free' &&
    !/^[a-z0-9._-]+\/[a-z0-9._-]+:free$/i.test(selected)
  )
    fail(
      'Phase 11.1 requires an explicit :free model ID or optional openrouter/free.',
    );
  return selected;
}

function responseCode(body) {
  const code = body?.error?.code;
  return typeof code === 'string' && /^[a-z0-9_]{1,64}$/i.test(code)
    ? code
    : null;
}

function errorCategory(body) {
  const message =
    typeof body?.error?.message === 'string' ? body.error.message : '';
  if (/quota|credit|daily limit|free tier limit/i.test(message))
    return 'quota_exhausted';
  if (/rate.?limit|too many requests/i.test(message)) return 'rate_limited';
  if (/no endpoints|provider.*unavailable|capacity/i.test(message))
    return 'capacity_unavailable';
  return null;
}

export async function generateText({
  messages,
  model,
  temperature = 0.1,
  maxTokens = 1800,
  metadata = {},
  options = {},
}) {
  const selected = selectedModel(model, options.env ?? process.env);
  if (
    !Array.isArray(messages) ||
    !messages.length ||
    messages.some(
      (item) =>
        !item ||
        !['system', 'user', 'assistant'].includes(item.role) ||
        typeof item.content !== 'string' ||
        !item.content.trim(),
    )
  )
    fail('messages must contain nonempty role/content entries.');
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2)
    fail('temperature must be between 0 and 2.');
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 8192)
    fail('maxTokens must be between 1 and 8192.');
  if (
    metadata === null ||
    typeof metadata !== 'object' ||
    Array.isArray(metadata)
  )
    fail('metadata must be an object.');
  const key =
    options.env === undefined
      ? process.env.OPENROUTER_API_KEY ||
        readDotenvValue('OPENROUTER_API_KEY', projectRoot)
      : options.env.OPENROUTER_API_KEY;
  if (!key?.trim()) fail('OPENROUTER_API_KEY is required.');
  const inputCharacters = messages.reduce(
    (sum, item) => sum + item.content.length,
    0,
  );
  console.log(
    `[Worldlayer] LLM request: openrouter, ${selected}, free, ${inputCharacters} input characters.`,
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  const wait =
    options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const maxRetries = options.maxRetries ?? 2;
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 3)
    fail('maxRetries must be between 0 and 3.');
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response;
    try {
      response = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: selected,
          messages,
          temperature,
          max_tokens: maxTokens,
        }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch {
      if (attempt < maxRetries) {
        await wait(500 * 2 ** attempt);
        continue;
      }
      fail('network request failed after bounded retries.');
    }
    let body;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    const code = responseCode(body);
    const category = errorCategory(body);
    if (!response.ok) {
      if ([401, 403].includes(response.status))
        fail(`authentication failed (HTTP ${response.status}).`);
      if ([400, 404, 422].includes(response.status))
        fail(
          `model or request unavailable (HTTP ${response.status}${code ? `, ${code}` : ''}).`,
        );
      if (
        response.status === 402 ||
        category === 'quota_exhausted' ||
        ['insufficient_quota', 'credit_balance_exhausted'].includes(code)
      )
        fail(
          `free quota exhausted (HTTP ${response.status}${code ? `, ${code}` : ''}).`,
        );
      if (
        [408, 429, 500, 502, 503, 504].includes(response.status) &&
        attempt < maxRetries
      ) {
        await wait(500 * 2 ** attempt);
        continue;
      }
      fail(
        `request failed (HTTP ${response.status}${code ? `, ${code}` : category ? `, ${category}` : ''}).`,
      );
    }
    const text = body?.choices?.[0]?.message?.content;
    const resolvedModel = body?.model;
    if (typeof text !== 'string' || !text.trim())
      fail(
        `returned an empty or malformed response (finish ${body?.choices?.[0]?.finish_reason ?? 'unknown'}).`,
      );
    if (typeof resolvedModel !== 'string' || !resolvedModel.trim())
      fail('did not identify the resolved model.');
    if (
      selected !== 'openrouter/free' &&
      resolvedModel !== selected &&
      resolvedModel !== selected.slice(0, -5)
    )
      fail(
        `resolved model ${resolvedModel} differs from the selected free model.`,
      );
    return {
      provider: 'openrouter',
      model: resolvedModel,
      requestedModel: selected,
      text: text.trim(),
      usage: body.usage ?? null,
      finishReason: body.choices[0].finish_reason ?? null,
    };
  }
}
