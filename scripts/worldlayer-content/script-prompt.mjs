export const SCRIPT_PROMPT_VERSION = 'worldlayer-script-v1';

export function claimBatches(claims, maxCharacters = 6500) {
  if (!Array.isArray(claims) || !claims.length)
    throw new Error('Worldlayer: script prompt requires approved claims.');
  const batches = [];
  let batch = [];
  let size = 0;
  for (const claim of claims) {
    const length = claim.text.length;
    if (length > maxCharacters)
      throw new Error(
        `Worldlayer: claim ${claim.id} exceeds the script prompt limit.`,
      );
    if (batch.length && (batch.length >= 12 || size + length > maxCharacters)) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(claim);
    size += length;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export function scriptMessages({ brief, claims, batchIndex, batchCount }) {
  const sourceClaims = claims.map((claim) => ({
    id: claim.id,
    category: claim.category,
    text: claim.text,
    sourceIds: claim.sourceIds,
    evidence:
      claim.evidence?.map((item) => ({
        sourceId: item.sourceId,
        excerpt: item.excerpt,
      })) ?? [],
  }));
  return [
    {
      role: 'system',
      content: [
        `Worldlayer script writer, prompt ${SCRIPT_PROMPT_VERSION}.`,
        'Use ONLY the approved claims supplied by the user. Do not add factual details, dates, quantities, quotes, or locations not present in those claims.',
        'Write clear English narration in source order. Every section must cite one or more supplied claim IDs that directly support its factual content.',
        'Return only JSON: {"sections":[{"text":"...","claimIds":["claim_001"]}]} with no markdown.',
        'Do not include source pages, invented claims, or unsupported assertions.',
      ].join(' '),
    },
    {
      role: 'user',
      content: JSON.stringify({
        topic: {
          title: brief.title,
          angle: brief.angle,
          audience: brief.audience,
          language: brief.language,
          targetDurationSeconds: brief.targetDurationSeconds,
        },
        sequence: { batch: batchIndex + 1, totalBatches: batchCount },
        approvedClaims: sourceClaims,
        outputSchema: {
          sections: [
            { text: 'narration passage', claimIds: ['approved claim id'] },
          ],
        },
      }),
    },
  ];
}
