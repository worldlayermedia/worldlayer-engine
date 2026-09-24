const MIN_WORDS = 9;
const MAX_WORDS = 42;

function words(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function ranges(source) {
  const paragraphs = [...source.matchAll(/\S[^\r\n]*(?:\r?\n(?!\s*\r?\n)[^\r\n]*)*/g)];
  return paragraphs.flatMap((paragraph) => {
    const value = paragraph[0];
    const sentences = [...value.matchAll(/[^.!?]+(?:[.!?]+|$)/g)]
      .filter((match) => match[0].trim())
      .map((match) => ({ start: paragraph.index + match.index, end: paragraph.index + match.index + match[0].length }));
    if (words(value) <= MAX_WORDS) return [{ start: paragraph.index, end: paragraph.index + value.length }];
    return sentences;
  });
}

export function analyzeScript(source, { minWords = MIN_WORDS, maxWords = MAX_WORDS } = {}) {
  if (typeof source !== 'string' || !source.trim())
    throw new Error('Worldlayer: planning script must be nonempty text.');
  if (!Number.isInteger(minWords) || !Number.isInteger(maxWords) || minWords < 1 || maxWords < minWords)
    throw new Error('Worldlayer: beat word limits are invalid.');
  const raw = ranges(source);
  const split = [];
  for (const range of raw) {
    if (words(source.slice(range.start, range.end)) <= maxWords) {
      split.push(range);
      continue;
    }
    const tokens = [...source.slice(range.start, range.end).matchAll(/\S+/g)];
    for (let offset = 0; offset < tokens.length; offset += maxWords) {
      const group = tokens.slice(offset, offset + maxWords);
      split.push({ start: range.start + group[0].index, end: range.start + group.at(-1).index + group.at(-1)[0].length });
    }
  }
  const merged = [];
  for (const range of split) {
    const last = merged.at(-1);
    if (last && (words(source.slice(last.start, last.end)) < minWords || words(source.slice(range.start, range.end)) < minWords))
      last.end = range.end;
    else merged.push({ ...range });
  }
  return merged.map(({ start, end }) => ({ text: source.slice(start, end).trim(), sourceText: source.slice(start, end), startOffset: start, endOffset: end }));
}
