export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateError";
  }
}

/**
 * Strict template engine. Replaces all {{key}} with values from vars.
 * Throws if any placeholder has no matching key.
 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  const placeholderPattern = /\{\{(\w+)\}\}/g;
  const usedKeys = new Set<string>();

  const result = template.replace(placeholderPattern, (match, key: string) => {
    if (!(key in vars)) {
      throw new TemplateError(`Missing template variable: {{${key}}}`);
    }
    usedKeys.add(key);
    return vars[key];
  });

  return result;
}
