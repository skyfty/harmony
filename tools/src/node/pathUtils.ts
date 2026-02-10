export function toPosixPath(p: string): string {
  return p.replace(/\\/g, "/");
}
