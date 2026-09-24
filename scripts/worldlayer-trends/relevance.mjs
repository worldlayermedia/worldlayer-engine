import { CATEGORIES, trendAge, validateTrend } from './schema.mjs';

const CATEGORY_TERMS = Object.freeze({
  geography:
    /\b(map|border|coast|island|river|lake|geograph|arctic|landslide)\b/i,
  cities:
    /\b(city|cities|urban|downtown|housing|subway|toronto|vancouver|montreal|calgary|ottawa)\b/i,
  infrastructure:
    /\b(bridge|dam|power grid|pipeline|tunnel|port|airport|railway|infrastructure)\b/i,
  aviation: /\b(aircraft|aviation|flight|airline|airport|runway)\b/i,
  transportation:
    /\b(transit|train|rail|highway|traffic|ferry|subway|transport)\b/i,
  science: /\b(space|satellite|research|science|solar|aurora|telescope)\b/i,
  natural_phenomena:
    /\b(earthquake|wildfire|storm|flood|volcano|aurora|hurricane)\b/i,
  megaprojects:
    /\b(megaproject|construction|high.speed rail|new airport|hydroelectric)\b/i,
  trade_and_logistics:
    /\b(shipping|supply chain|freight|cargo|trade route|container port)\b/i,
});
const DEFAULT_EXCLUSIONS = Object.freeze({
  celebrity_gossip:
    /\b(celebrity|dating rumor|divorce gossip|influencer drama)\b/i,
  sports_scores: /\b(score|vs\.?|playoff result|match result)\b/i,
  entertainment_only:
    /\b(movie trailer|album release|reality show|tv finale)\b/i,
  shopping: /\b(discount|coupon|black friday|product review|sale price)\b/i,
  local_incident: /\b(local incident|minor collision|store closure)\b/i,
});
const ENHANCED_REVIEW =
  /\b(election|vote|prime minister|president|parliament|armed conflict|war|invasion|contested border|territorial claim|geopolitic)\b/i;
const SPATIAL =
  /\b(where|why|route|map|region|network|corridor|border|across|connect|distribution|geograph|spatial)\b/i;
const SHORT_LIVED = /\b(today|tonight|score|sale|trailer|breaking)\b/i;

export function evaluateTrend(
  trend,
  { now = new Date(), maxAgeHours = 24, exclusions = DEFAULT_EXCLUSIONS } = {},
) {
  validateTrend(trend);
  const matches = CATEGORIES.filter(
    (category) =>
      category !== 'other' && CATEGORY_TERMS[category]?.test(trend.query),
  );
  const category =
    matches.find((item) => item !== 'geography') ?? matches[0] ?? 'other';
  const excludedBy = Object.entries(exclusions)
    .filter(([, rule]) =>
      (rule instanceof RegExp ? rule : new RegExp(rule, 'i')).test(trend.query),
    )
    .map(([name]) => name);
  const age = trendAge(trend, now, maxAgeHours);
  const geographic =
    /\b(canada|canadian|toronto|vancouver|montreal|calgary|ottawa|arctic|ontario|quebec|alberta|british columbia)\b/i.test(
      trend.query,
    )
      ? 1
      : 0;
  const visualizable = matches.length || SPATIAL.test(trend.query) ? 1 : 0;
  const shelfLife = SHORT_LIVED.test(trend.query)
    ? 0.25
    : category === 'other'
      ? 0.5
      : 0.75;
  const momentum =
    trend.trendStatus === 'rising' || trend.trendStatus === 'active' ? 1 : null;
  const worldlayerFit = {
    geographic,
    visualizable,
    infrastructure: matches.includes('infrastructure') ? 1 : 0,
    aviation: matches.includes('aviation') ? 1 : 0,
    transport: matches.includes('transportation') ? 1 : 0,
    urban: matches.includes('cities') ? 1 : 0,
    scienceOrNature:
      matches.includes('science') || matches.includes('natural_phenomena')
        ? 1
        : 0,
    spatialStory:
      SPATIAL.test(trend.query) ||
      matches.some((item) =>
        [
          'geography',
          'infrastructure',
          'trade_and_logistics',
          'megaprojects',
        ].includes(item),
      )
        ? 1
        : 0,
    shelfLife,
    momentum,
  };
  const weights = {
    geographic: 1,
    visualizable: 2,
    infrastructure: 1,
    aviation: 1,
    transport: 1,
    urban: 1,
    scienceOrNature: 1,
    spatialStory: 2,
    shelfLife: 1,
    momentum: 0.5,
  };
  const score = Number(
    Object.entries(worldlayerFit)
      .reduce((sum, [key, value]) => sum + (value ?? 0) * weights[key], 0)
      .toFixed(2),
  );
  const reasons = Object.entries(worldlayerFit)
    .filter(([, value]) => value === 1)
    .map(([key]) => `${key} signal in the trend query or provider status`);
  if (excludedBy.length)
    reasons.push(`Configured exclusions: ${excludedBy.join(', ')}`);
  if (age.stale)
    reasons.push(`Observation is outside the ${maxAgeHours}h freshness limit`);
  return {
    trendId: trend.id,
    topic: trend.query,
    category,
    worldlayerFit,
    score,
    reasons,
    excludedBy,
    requiresEnhancedReview: ENHANCED_REVIEW.test(trend.query),
    status: age.stale
      ? 'stale'
      : excludedBy.length
        ? 'excluded'
        : score >= 4
          ? 'candidate'
          : 'low_fit',
  };
}

export function rankCandidates(trends, options) {
  return trends
    .map((trend) => evaluateTrend(trend, options))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.topic.localeCompare(b.topic) ||
        a.trendId.localeCompare(b.trendId),
    );
}

export { DEFAULT_EXCLUSIONS };
