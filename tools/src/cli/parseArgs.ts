// Very small argv parser: supports `--key value` and `--key=value`.
export function parseArgs(argv: string[]): Map<string, string> {
  const map = new Map<string, string>();

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;

    const raw = token.slice(2);
    const eq = raw.indexOf("=");

    if (eq >= 0) {
      const key = raw.slice(0, eq);
      const value = raw.slice(eq + 1);
      map.set(key, value);
      continue;
    }

    const key = raw;
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      map.set(key, next);
      i++;
    } else {
      map.set(key, "true");
    }
  }

  return map;
}
