export function nowISO(): string {
  return new Date().toISOString();
}

export function shortId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}-${time}-${random}`;
}
