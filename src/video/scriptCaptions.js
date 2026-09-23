export function segmentNarration(text, { maxWords = 12 } = {}) {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) throw new Error('Worldlayer: narration script is empty.');
  if (!Number.isInteger(maxWords) || maxWords < 1)
    throw new Error('Worldlayer: caption maxWords must be positive.');
  const sentences = normalized.match(/[^.!?]+[.!?]*|[.!?]+/g) ?? [];
  const segments = [];
  for (const sentence of sentences) {
    const sentenceWords = sentence.trim().split(/\s+/).filter(Boolean);
    if (sentenceWords.length <= maxWords) {
      segments.push(sentenceWords.join(' '));
      continue;
    }
    const clauses = sentence.match(/[^,;:]+[,;:]?/g) ?? [sentence];
    let current = [];
    const flush = () => {
      if (current.length) segments.push(current.join(' '));
      current = [];
    };
    for (const clause of clauses) {
      const words = clause.trim().split(/\s+/).filter(Boolean);
      if (current.length + words.length > maxWords) flush();
      for (let index = 0; index < words.length; index += maxWords) {
        const chunk = words.slice(index, index + maxWords);
        if (current.length + chunk.length > maxWords) flush();
        current.push(...chunk);
        if (current.length === maxWords) flush();
      }
    }
    flush();
  }
  return segments;
}

export function scriptCaptions(text, narrationDuration, options) {
  if (!Number.isFinite(narrationDuration) || narrationDuration <= 0)
    throw new Error('Worldlayer: script captions require narration duration.');
  const segments = segmentNarration(text, options);
  const totalMilliseconds = Math.floor(narrationDuration * 1000);
  if (segments.length > totalMilliseconds)
    throw new Error('Worldlayer: narration is too short for script captions.');
  const lengths = segments.map((segment) => segment.replace(/\s/g, '').length);
  const totalLength = lengths.reduce((sum, length) => sum + length, 0);
  const extra = totalMilliseconds - segments.length;
  const shares = lengths.map((length) => (extra * length) / totalLength);
  const milliseconds = shares.map((share) => 1 + Math.floor(share));
  let residual =
    totalMilliseconds - milliseconds.reduce((sum, value) => sum + value, 0);
  const order = shares
    .map((share, index) => ({ index, fraction: share % 1 }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let index = 0; index < residual; index++)
    milliseconds[order[index].index]++;
  let start = 0;
  return segments.map((segment, index) => {
    const end = start + milliseconds[index];
    const caption = { start: start / 1000, end: end / 1000, text: segment };
    start = end;
    return caption;
  });
}
