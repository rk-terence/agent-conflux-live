/**
 * Clean utterance text following the pipeline from DESIGN.md/ARCHITECTURE.md.
 * Returns cleaned string, or null if the utterance should be treated as silence.
 *
 * The result includes boolean flags for each cleaning step that fired,
 * enabling structured logging of utterance filtering decisions.
 */
export interface CleanUtteranceResult {
  text: string | null;
  historyHallucination: boolean;
  speakerPrefixStripped: boolean;
  actionStripped: boolean;
  silenceByLength: boolean;
}

export function cleanUtterance(
  text: string,
  agentNames: string[],
): CleanUtteranceResult {
  let speakerPrefixStripped = false;
  let actionStripped = false;

  // 1. History hallucination check: starts with - [Ns] or [Ns]
  if (/^-?\s*\[[\d.]+s\]/.test(text)) {
    return { text: null, historyHallucination: true, speakerPrefixStripped: false, actionStripped: false, silenceByLength: false };
  }

  let cleaned = text;

  // 2. Strip speaker prefix — check all agent names and "你"
  const allNames = [...agentNames, "你"];
  for (const name of allNames) {
    // [Name]： or [Name]:
    const bracketColonPattern = new RegExp(`^\\[${escapeRegex(name)}\\][：:]\\s*`);
    if (bracketColonPattern.test(cleaned)) {
      cleaned = cleaned.replace(bracketColonPattern, "");
      speakerPrefixStripped = true;
      break;
    }
    // **Name**： or **Name**:
    const boldColonPattern = new RegExp(`^\\*\\*${escapeRegex(name)}\\*\\*[：:]\\s*`);
    if (boldColonPattern.test(cleaned)) {
      cleaned = cleaned.replace(boldColonPattern, "");
      speakerPrefixStripped = true;
      break;
    }
    // Name： or Name:
    const plainColonPattern = new RegExp(`^${escapeRegex(name)}[：:]\\s*`);
    if (plainColonPattern.test(cleaned)) {
      cleaned = cleaned.replace(plainColonPattern, "");
      speakerPrefixStripped = true;
      break;
    }
    // **Name** 说： or Name 说：
    const saidPattern = new RegExp(`^(\\*\\*)?${escapeRegex(name)}(\\*\\*)?\\s*说[：:]\\s*`);
    if (saidPattern.test(cleaned)) {
      cleaned = cleaned.replace(saidPattern, "");
      speakerPrefixStripped = true;
      break;
    }
    // **Name** 说了一半：
    const halfSaidPattern = new RegExp(`^\\*\\*${escapeRegex(name)}\\*\\*\\s*说了一半[：:]\\s*`);
    if (halfSaidPattern.test(cleaned)) {
      cleaned = cleaned.replace(halfSaidPattern, "");
      speakerPrefixStripped = true;
      break;
    }
  }

  // 2b. Re-check history hallucination after prefix stripping
  if (/^-?\s*\[[\d.]+s\]/.test(cleaned)) {
    return { text: null, historyHallucination: true, speakerPrefixStripped, actionStripped: false, silenceByLength: false };
  }

  // 3. Strip parenthetical actions: （...） and (...)
  const beforeActions = cleaned;
  cleaned = cleaned.replace(/（[^）]*）/g, "");
  cleaned = cleaned.replace(/\([^)]*\)/g, "");
  if (cleaned !== beforeActions) {
    actionStripped = true;
  }

  // 4. Trim whitespace
  cleaned = cleaned.trim();

  // 5. Minimum length: < 4 characters → silence
  if (cleaned.length < 4) {
    return { text: null, historyHallucination: false, speakerPrefixStripped, actionStripped, silenceByLength: true };
  }

  return { text: cleaned, historyHallucination: false, speakerPrefixStripped, actionStripped, silenceByLength: false };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
