/**
 * Prompt composition — combines the three semantic parts of a prompt
 * into the two transport fields that the model gateway accepts.
 */

/**
 * The three semantic parts of every agent prompt.
 *
 * - `systemPrompt`: stable role description and behavioral rules
 * - `projectedHistory`: perspective-specific markdown transcript of prior events
 * - `turnDirective`: the instruction for this call, including situational hints
 */
export type PromptParts = {
  readonly systemPrompt: string;
  readonly projectedHistory: string;
  readonly turnDirective: string;
};

/**
 * Compose projected history and turn directive into a single user-prompt string.
 *
 * When projected history is empty (e.g. first round), only the turn directive is used.
 * Otherwise they are separated by a blank line.
 */
export function composeUserPrompt(parts: Pick<PromptParts, "projectedHistory" | "turnDirective">): string {
  if (!parts.projectedHistory) {
    return parts.turnDirective;
  }
  return `${parts.projectedHistory}\n\n${parts.turnDirective}`;
}
