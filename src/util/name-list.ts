/**
 * Format a list of names in Chinese style.
 * 1 name: "A"
 * 2 names: "A 和 B"
 * 3+ names: "A、B 和 C"
 */
export function formatNameList(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} 和 ${names[1]}`;
  return names.slice(0, -1).join("、") + " 和 " + names[names.length - 1];
}
