/**
 * Split utterance at a sentence boundary for interruption evaluation.
 * Returns { spokenPart, unspokenPart } or null if no valid split point exists.
 */
export function splitUtterance(
  text: string,
  threshold: number,
  tokenCount: (text: string) => number,
): { spokenPart: string; unspokenPart: string } | null {
  // Find all sentence boundary positions.
  // A boundary is immediately after: 。！？!?  or . when followed by space or end of string
  const boundaries: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "。" || ch === "！" || ch === "？" || ch === "!" || ch === "?") {
      boundaries.push(i + 1);
    } else if (ch === ".") {
      // Only split on period when followed by space or end of string (avoid decimals)
      if (i + 1 >= text.length || text[i + 1] === " ") {
        boundaries.push(i + 1);
      }
    }
  }

  // Walk boundaries; find the last boundary where spoken part fits within threshold
  let lastValidBoundary: number | null = null;
  for (const boundary of boundaries) {
    const spoken = text.slice(0, boundary);
    if (tokenCount(spoken) <= threshold) {
      lastValidBoundary = boundary;
    } else {
      break;
    }
  }

  if (lastValidBoundary === null || lastValidBoundary >= text.length) {
    return null; // No valid split or the whole text is one sentence
  }

  return {
    spokenPart: text.slice(0, lastValidBoundary),
    unspokenPart: text.slice(lastValidBoundary),
  };
}
