// Discovery returns candidates only; it never fetches source pages.
function decode(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

// Best-effort public experiment. Challenges are treated as failure, never bypassed.
export async function searchDuckDuckGo(query, { fetchImpl = fetch } = {}) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(12000),
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!response.ok)
    throw new Error(`Worldlayer: web search returned HTTP ${response.status}.`);
  const html = await response.text();
  if (!html.includes('result__a'))
    throw new Error('Worldlayer: web search returned no parseable results.');
  return [
    ...html.matchAll(
      /<a\b([^>]*class=["'][^"']*result__a[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi,
    ),
  ]
    .map((match) => {
      const href = decode(match[1].match(/href=["']([^"']+)["']/i)?.[1] ?? '');
      try {
        const redirect = new URL(href, 'https://duckduckgo.com');
        return {
          url: redirect.searchParams.get('uddg') ?? redirect.href,
          title: decode(match[2].replace(/<[^>]+>/g, ' ').trim()),
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export const searchProviders = Object.freeze({
  mock: (search) => ({ search }),
  supplied: (urls) => ({
    candidates: () => urls.map((url) => ({ url })),
  }),
  duckduckgo: { search: searchDuckDuckGo },
});

export async function discoverSources({
  queries,
  searchProvider,
  suppliedProvider,
}) {
  const candidates = suppliedProvider.candidates().map((candidate) => ({
    ...candidate,
    discovery: 'supplied',
  }));
  const searchAttempts = [];
  for (const query of queries) {
    try {
      const results = await searchProvider.search(query);
      if (!Array.isArray(results))
        throw new Error('search results must be an array');
      candidates.push(
        ...results.map((candidate) => ({ ...candidate, discovery: 'search' })),
      );
      searchAttempts.push({
        query,
        status: 'success',
        candidateCount: results.length,
      });
    } catch (error) {
      searchAttempts.push({ query, status: 'failed', reason: error.message });
    }
  }
  return { candidates, searchAttempts };
}
