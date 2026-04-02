export function createTokenCounter(custom?: (text: string) => number): (text: string) => number {
  if (custom) return custom;
  return defaultTokenCount;
}

function defaultTokenCount(text: string): number {
  return Math.ceil(text.length * 0.6);
}
