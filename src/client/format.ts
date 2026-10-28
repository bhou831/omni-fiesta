/** Token amounts everywhere: thousands separators and a true minus sign. */
export function formatTokens(value: number, { signed = false } = {}) {
  const digits = Math.abs(value).toLocaleString();
  if (value < 0) return `−${digits}`;
  return signed && value > 0 ? `+${digits}` : digits;
}
