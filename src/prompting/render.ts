/**
 * Strict slot renderer for prompt templates.
 *
 * Replaces `{{key}}` placeholders with values from a vars object.
 * Throws if any placeholder has no corresponding variable.
 */
export function render(
  template: string,
  vars: Readonly<Record<string, string>>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    if (!(key in vars)) {
      throw new Error(`Missing template variable: {{${key}}}`);
    }
    return vars[key];
  });
}
