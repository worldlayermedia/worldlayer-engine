// Retrieval accepts a known URL. Discovery is handled separately.
export async function fetchHtml(url, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(15000),
    headers: { 'User-Agent': 'WorldlayerResearch/0.1' },
  });
  if (!response.ok)
    throw new Error(
      `Worldlayer: source fetch returned HTTP ${response.status}.`,
    );
  if (!response.headers.get('content-type')?.includes('html'))
    throw new Error('Worldlayer: source is not HTML.');
  const html = await response.text();
  if (html.length > 2_000_000)
    throw new Error('Worldlayer: source page exceeds extraction limit.');
  return { url: response.url, html };
}

export const sourceFetchers = Object.freeze({
  html: { fetch: fetchHtml },
  mock: (fetchPage) => ({ fetch: fetchPage }),
});
