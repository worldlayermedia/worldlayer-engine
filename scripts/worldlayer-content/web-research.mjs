import { isIP } from 'node:net';
import {
  discoverSources,
  searchProviders,
  searchDuckDuckGo,
} from './search-discovery.mjs';
import { fetchHtml } from './source-fetcher.mjs';
import {
  validateTopicBrief,
  validateResearchPacket,
  researchDigest,
} from './schema.mjs';

const AUTHORITATIVE_HOSTS = [
  'toronto.ca',
  'statcan.gc.ca',
  'ttc.ca',
  'metrolinx.com',
  'ontario.ca',
  'canada.ca',
];
const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|mc_)/i;

function decode(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(
      /&(?:amp|lt|gt|quot|apos|nbsp);/g,
      (entity) =>
        ({
          '&amp;': '&',
          '&lt;': '<',
          '&gt;': '>',
          '&quot;': '"',
          '&apos;': "'",
          '&nbsp;': ' ',
        })[entity],
    );
}

export function normalizeSourceUrl(raw) {
  const url = new URL(raw);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    isIP(host) ||
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    url.username ||
    url.password ||
    (url.port && !['80', '443'].includes(url.port))
  )
    throw new Error('Worldlayer: research source URL must be public HTTP(S).');
  url.protocol = 'https:';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  url.hash = '';
  for (const key of [...url.searchParams.keys()])
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString();
}

export function researchQuestions(brief) {
  validateTopicBrief(brief);
  return [
    ...new Set([
      `What established evidence explains ${brief.title}?`,
      `What evidence supports this angle: ${brief.angle}?`,
      ...(brief.keyQuestions ?? []),
      ...(brief.requiredPoints ?? []).map(
        (point) => `What sources support ${point}?`,
      ),
      ...(brief.exclusions ?? []).map(
        (point) =>
          `What claims about ${point} should be excluded without current evidence?`,
      ),
    ]),
  ];
}

export function searchQueries(brief) {
  const place = Object.keys(brief.locations)[0] ?? brief.title;
  const topics = [
    brief.title,
    brief.angle,
    ...(brief.keyQuestions ?? []),
    ...(brief.requiredPoints ?? []),
    ...(brief.exclusions ?? []),
  ];
  return [
    ...new Set(
      topics.map(
        (topic, index) =>
          `${place} ${topic} site:${index % 3 === 1 ? 'statcan.gc.ca' : 'toronto.ca'}`,
      ),
    ),
  ].slice(0, 9);
}

function meta(html, key) {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const name = tag.match(/(?:name|property)=["']([^"']+)["']/i)?.[1];
    if (name?.toLowerCase() !== key.toLowerCase()) continue;
    return (
      decode(tag.match(/content=["']([^"']+)["']/i)?.[1] ?? '') || undefined
    );
  }
  return undefined;
}

function sourceType(host) {
  if (
    host.endsWith('.gc.ca') ||
    host.endsWith('.gov') ||
    host === 'toronto.ca' ||
    host.endsWith('.toronto.ca') ||
    host === 'ontario.ca' ||
    host === 'canada.ca'
  )
    return 'government';
  if (host.endsWith('.edu') || host.endsWith('.ac.uk')) return 'academic';
  if (host === 'ttc.ca' || host.endsWith('.ttc.ca') || host === 'metrolinx.com')
    return 'official_operator';
  return 'institutional_or_secondary';
}

function pageText(html) {
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? html;
  return decode(
    main
      .replace(/<(script|style|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function candidateSentences(html, brief) {
  const locationNames = Object.keys(brief.locations);
  const excluded = (brief.exclusions ?? []).map((item) => item.toLowerCase());
  const focus =
    /lake|water|shore|island|route|street|neighbou?rhood|transit|rail|road|region|downtown|geograph|park|valley|harbou?r|connection|population/i;
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? html;
  const passages = [
    ...main.matchAll(/<(?:p|li)\b[^>]*>([\s\S]*?)<\/(?:p|li)>/gi),
  ].map((match) => pageText(match[1]));
  return passages
    .flatMap((passage) => passage.split(/(?<=[.!?])\s+/))
    .map((text) => text.trim())
    .filter((text) => {
      const words = text.split(/\s+/).length;
      const lower = text.toLowerCase();
      return (
        words >= 9 &&
        words <= 36 &&
        text.length <= 180 &&
        focus.test(text) &&
        locationNames.some((name) => lower.includes(name.toLowerCase())) &&
        !excluded.some((item) => item.length > 8 && lower.includes(item)) &&
        !/cookie|privacy|subscribe|click here|javascript|copyright|all rights reserved|https?:\/\/|skip to content|i want to|plan a day trip|your browser|newsletter|for the most recent|use toronto|enjoy |visit |great|refreshing|convenient|jewel|vibrant|iconic|future|will grow|is needed to|successful strategy/i.test(
          text,
        )
      );
    });
}

function claimPeriod(text) {
  return text.match(/\b(?:19|20)\d{2}\b/)?.[0];
}

function conflictKey(text) {
  const kind = /\bpopulation\b/i.test(text)
    ? 'population'
    : /\bshoreline\b/i.test(text)
      ? 'shoreline'
      : null;
  if (!kind) return null;
  const scope = /metropolitan|\bCMA\b/i.test(text) ? 'metro' : 'city';
  return `${kind}:${scope}:${claimPeriod(text) ?? 'undated'}`;
}

function numericValue(text) {
  const period = claimPeriod(text);
  return [...text.matchAll(/\b\d[\d,.]*\b/g)]
    .map((match) => match[0].replaceAll(',', ''))
    .find((value) => value !== period);
}

function landAreaTableValue(html) {
  const description = decode(
    html.match(
      /<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i,
    )?.[1] ?? '',
  );
  return description
    .match(/Land Area\s*\(km\s*2\)\s*([\d,]+)/i)?.[1]
    ?.replaceAll(',', '');
}

export function detectClaimConflicts(claims) {
  const groups = new Map();
  const uncertainties = [];
  for (const claim of claims) {
    const key = conflictKey(claim.text);
    const value = numericValue(claim.text);
    if (!key || !value) continue;
    const prior = groups.get(key);
    if (prior && prior.value !== value) {
      claim.status = 'partially_supported';
      prior.claim.status = 'partially_supported';
      uncertainties.push(
        `Conflicting ${key} values: ${prior.claim.id} (${prior.value}) and ${claim.id} (${value}).`,
      );
    } else groups.set(key, { value, claim });
  }
  return uncertainties;
}

function pointSupported(point, claims) {
  const terms =
    point
      .toLowerCase()
      .match(/[a-z]{4,}/g)
      ?.filter(
        (term) =>
          !['across', 'through', 'about', 'setting', 'region'].includes(term),
      ) ?? [];
  return claims.some((claim) => {
    const text = claim.text.toLowerCase();
    return (
      terms.length > 0 && terms.every((term) => text.includes(term.slice(0, 5)))
    );
  });
}

export async function researchWeb({
  brief,
  search = searchDuckDuckGo,
  fetchPage = fetchHtml,
  now = () => new Date(),
  seedUrls = [],
}) {
  validateTopicBrief(brief);
  if (!Array.isArray(seedUrls))
    throw new Error('Worldlayer: seedUrls must be an array.');
  const questions = researchQuestions(brief);
  const uncertainties = [];
  const queries = searchQueries(brief);
  const { candidates, searchAttempts } = await discoverSources({
    queries,
    searchProvider:
      search === searchDuckDuckGo
        ? searchProviders.duckduckgo
        : searchProviders.mock(search),
    suppliedProvider: searchProviders.supplied(seedUrls),
  });
  for (const attempt of searchAttempts)
    if (attempt.status === 'failed')
      uncertainties.push(
        `Search failed for ${attempt.query}: ${attempt.reason}`,
      );
  const successfulSearchCount = searchAttempts.filter(
    (attempt) => attempt.status === 'success',
  ).length;
  const discoveredSearchCount = searchAttempts.reduce(
    (count, attempt) => count + (attempt.candidateCount ?? 0),
    0,
  );
  if (!successfulSearchCount && !seedUrls.length)
    throw new Error(
      'Worldlayer: insufficient discoverable evidence: search failed and no supplied source URLs exist.',
    );
  if (!candidates.length)
    throw new Error('Worldlayer: web research found no source candidates.');
  const unique = new Map();
  for (const candidate of candidates) {
    try {
      const url = normalizeSourceUrl(candidate.url);
      if (!unique.has(url))
        unique.set(url, { ...candidate, discoveries: [candidate.discovery] });
      else {
        const existing = unique.get(url);
        if (!existing.discoveries.includes(candidate.discovery))
          existing.discoveries.push(candidate.discovery);
      }
    } catch {
      /* Ignore unsafe or malformed search hits. */
    }
  }
  const ranked = [...unique.entries()].sort(([a], [b]) => {
    const score = (url) =>
      AUTHORITATIVE_HOSTS.some((host) => new URL(url).hostname.endsWith(host))
        ? 0
        : 1;
    return score(a) - score(b);
  });
  const authoritative = ranked.filter(([url]) =>
    AUTHORITATIVE_HOSTS.some((host) => new URL(url).hostname.endsWith(host)),
  );
  const ordered = (authoritative.length >= 3 ? authoritative : ranked).slice(
    0,
    15,
  );
  const sources = [];
  const finalSources = new Map();
  const claims = [];
  const claimKeys = new Map();
  const accessedDate = now().toISOString().slice(0, 10);
  for (const [url, candidate] of ordered) {
    try {
      const page = await fetchPage(url);
      const html = page.html;
      if (typeof html !== 'string' || !html.trim())
        throw new Error('empty or malformed HTML');
      const actualUrl = normalizeSourceUrl(page.url ?? url);
      if (finalSources.has(actualUrl)) {
        const existing = finalSources.get(actualUrl);
        for (const origin of candidate.discoveries)
          if (!existing.discovery.includes(origin))
            existing.discovery.push(origin);
        continue;
      }
      const host = new URL(actualUrl).hostname;
      const source = {
        id: `source_${String(sources.length + 1).padStart(3, '0')}`,
        title:
          meta(html, 'og:title') ||
          decode(
            html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
              candidate.title ||
              host,
          ).trim(),
        publisher: meta(html, 'og:site_name') ?? host,
        url: actualUrl,
        accessedDate,
        sourceType: sourceType(host),
        discovery: candidate.discoveries,
      };
      const publicationDate =
        meta(html, 'article:published_time') ?? meta(html, 'datePublished');
      if (publicationDate && /^\d{4}-\d{2}-\d{2}/.test(publicationDate))
        source.publicationDate = publicationDate.slice(0, 10);
      const author = meta(html, 'author');
      if (author) source.author = author;
      const sentences = candidateSentences(html, brief).slice(0, 3);
      if (!sentences.length) {
        uncertainties.push(`No usable page evidence at ${actualUrl}.`);
        continue;
      }
      finalSources.set(actualUrl, source);
      sources.push(source);
      const tableArea = landAreaTableValue(html);
      for (const sentence of sentences) {
        const key = sentence
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ' ')
          .trim();
        const existing = claimKeys.get(key);
        const evidence = {
          sourceId: source.id,
          excerpt: sentence.slice(0, 180),
          context: 'page body',
        };
        if (existing) {
          if (!existing.sourceIds.includes(source.id)) {
            existing.sourceIds.push(source.id);
            existing.evidence.push(evidence);
          }
          continue;
        }
        const period = claimPeriod(sentence);
        const sensitive =
          /population|ranking|largest|third-largest|passengers|ridership|construction|annual|traffic volume|airports|flights|operates|\bminutes?\b|trains running|trains have|free wi-fi|service/i.test(
            sentence,
          );
        const unsuitable =
          /\b(must|should|competitive|wonderful|unique|global city|integral|vitality)\b|^airport connections:|^maps, safety|^use |^enjoy /i.test(
            sentence,
          );
        const status = unsuitable
          ? 'excluded'
          : sensitive && !period
            ? 'partially_supported'
            : source.sourceType === 'institutional_or_secondary'
              ? 'partially_supported'
              : 'verified';
        const claim = {
          id: `claim_${String(claims.length + 1).padStart(3, '0')}`,
          text: sentence,
          status,
          category:
            /\b(?:estimate|estimated|approximately|about)\b/i.test(sentence) &&
            /\d/.test(sentence)
              ? 'ESTIMATE'
              : /\d/.test(sentence)
                ? 'OBSERVED_DATA'
                : 'VERIFIED_FACT',
          sourceIds: [source.id],
          evidence: [evidence],
          ...(period ? { period } : {}),
        };
        if (sensitive && !period)
          uncertainties.push(
            `Time-sensitive claim ${claim.id} has no explicit period.`,
          );
        const proseArea = sentence
          .match(/\bcovers\s+([\d,]+)\s*sq\.?\s*km\b/i)?.[1]
          ?.replaceAll(',', '');
        if (tableArea && proseArea && tableArea !== proseArea) {
          claim.status = 'partially_supported';
          uncertainties.push(
            `Land-area conflict in ${source.id}: indicator table says ${tableArea} km² while ${claim.id} says ${proseArea} km².`,
          );
        }
        if (unsuitable)
          uncertainties.push(
            `Claim ${claim.id} is excluded as navigational, promotional, or normative text.`,
          );
        claims.push(claim);
        claimKeys.set(key, claim);
      }
    } catch (error) {
      uncertainties.push(`Source unavailable at ${url}: ${error.message}`);
    }
  }
  if (sources.length < 2 || claims.length < 3)
    throw new Error(
      `Worldlayer: insufficient usable web evidence (${sources.length} sources, ${claims.length} claims).`,
    );
  uncertainties.push(...detectClaimConflicts(claims));
  for (const point of brief.requiredPoints ?? []) {
    if (pointSupported(point, claims)) continue;
    const id = `claim_${String(claims.length + 1).padStart(3, '0')}`;
    claims.push({
      id,
      text: point,
      status: 'unresolved',
      category: 'VERIFIED_FACT',
      sourceIds: [],
      evidence: [],
    });
    uncertainties.push(
      `Required point ${id} has no direct page evidence: ${point}.`,
    );
  }
  const discoveryMode = seedUrls.length
    ? discoveredSearchCount
      ? 'mixed'
      : 'supplied_sources'
    : 'search';
  const packet = {
    version: '0.1',
    topic: brief.title,
    researchQuestions: questions,
    findings: claims
      .filter((claim) => !['unresolved', 'excluded'].includes(claim.status))
      .map((claim) => ({ text: claim.text, claimIds: [claim.id] })),
    sources,
    claims,
    uncertainties,
    suggestedVisuals: Object.keys(brief.locations)
      .filter((key) =>
        claims.some((claim) =>
          claim.text.toLowerCase().includes(key.toLowerCase()),
        ),
      )
      .map((key) => ({
        description: `Known location reference: ${key}`,
        locationKey: key,
      })),
    provenance: {
      provider: 'web',
      extraction: 'deterministic_page_paragraph_sentences',
    },
    discovery: {
      mode: discoveryMode,
      searchAttempts,
      sourceCount: sources.length,
    },
    run: {
      provider: 'web',
      discoveryMode,
      researchTimestamp: now().toISOString(),
      queryCount: queries.length,
      successfulSearchCount,
      failedSearchCount: searchAttempts.length - successfulSearchCount,
      suppliedUrlCount: seedUrls.length,
      fetchedSourceCount: sources.length,
    },
    approval: { status: 'pending' },
  };
  packet.researchId = researchDigest(packet);
  return validateResearchPacket(packet);
}
