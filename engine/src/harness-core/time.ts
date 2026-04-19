export function utcnow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}
