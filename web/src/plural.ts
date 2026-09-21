/** "1 day", "2 days" — count plus a noun that agrees with it. */
export function plural(count: number, noun: string, plural?: string): string {
  const word = count === 1 ? noun : (plural ?? `${noun}s`);
  return `${count} ${word}`;
}
