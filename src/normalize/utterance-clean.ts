/**
 * Clean utterance text following the pipeline from DESIGN.md/ARCHITECTURE.md.
 * Returns cleaned string, or null if the utterance should be treated as silence.
 *
 * The `historyHallucination` flag in the return distinguishes hallucination-silence
 * (which must also clear thought) from other forms of silence.
 */
export function cleanUtterance(
  text: string,
  agentNames: string[],
): { text: string | null; historyHallucination: boolean } {
  // 1. History hallucination check: starts with - [Ns] or [Ns]
  if (/^-?\s*\[[\d.]+s\]/.test(text)) {
    return { text: null, historyHallucination: true };
  }

  let cleaned = text;

  // 2. Strip speaker prefix — check all agent names and "你"
  const allNames = [...agentNames, "你"];
  for (const name of allNames) {
    // **Name**： or **Name**:
    const boldColonPattern = new RegExp(`^\\*\\*${escapeRegex(name)}\\*\\*[：:]\\s*`);
    if (boldColonPattern.test(cleaned)) {
      cleaned = cleaned.replace(boldColonPattern, "");
      break;
    }
    // Name： or Name:
    const plainColonPattern = new RegExp(`^${escapeRegex(name)}[：:]\\s*`);
    if (plainColonPattern.test(cleaned)) {
      cleaned = cleaned.replace(plainColonPattern, "");
      break;
    }
    // **Name** 说： or Name 说：
    const saidPattern = new RegExp(`^(\\*\\*)?${escapeRegex(name)}(\\*\\*)?\\s*说[：:]\\s*`);
    if (saidPattern.test(cleaned)) {
      cleaned = cleaned.replace(saidPattern, "");
      break;
    }
    // **Name** 说了一半：
    const halfSaidPattern = new RegExp(`^\\*\\*${escapeRegex(name)}\\*\\*\\s*说了一半[：:]\\s*`);
    if (halfSaidPattern.test(cleaned)) {
      cleaned = cleaned.replace(halfSaidPattern, "");
      break;
    }
  }

  // 3. Strip parenthetical actions: （...） and (...)
  cleaned = cleaned.replace(/（[^）]*）/g, "");
  cleaned = cleaned.replace(/\([^)]*\)/g, "");

  // 4. Trim whitespace
  cleaned = cleaned.trim();

  // 5. Minimum length: < 4 characters → silence
  if (cleaned.length < 4) {
    return { text: null, historyHallucination: false };
  }

  return { text: cleaned, historyHallucination: false };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
