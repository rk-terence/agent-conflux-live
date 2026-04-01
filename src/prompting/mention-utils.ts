/**
 * Detect whether an agent was @mentioned after their last speech in projected history.
 *
 * The history projector renders the agent's own speech in two formats:
 * - Normal turn:      `**你**：`
 * - Collision winner:  `你说：`
 * Both must be checked to find the true "last speech" position.
 */
export function wasMentionedAfterLastSpeech(
  projectedHistory: string,
  agentName: string,
): boolean {
  const mentionTag = `@${agentName}`;
  const lastMention = projectedHistory.lastIndexOf(mentionTag);
  if (lastMention === -1) return false;

  const lastNormalSpeech = projectedHistory.lastIndexOf(`**你**：`);
  const lastCollisionSpeech = projectedHistory.lastIndexOf(`你说：`);
  const lastSpeech = Math.max(lastNormalSpeech, lastCollisionSpeech);

  return lastMention > lastSpeech;
}
