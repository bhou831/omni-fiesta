/** Parse the decimal representation of a positive market price exactly, including exponent notation. */
function decimal(value: string): [bigint, bigint] {
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(value);
  if (!match) throw new Error('Invalid market price');
  const fraction = match[2] ?? '';
  const exponent = Number(match[3] ?? 0) - fraction.length;
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100)
    throw new Error('Invalid market price');
  const digits = BigInt(match[1] + fraction);
  if (digits <= 0n) throw new Error('Invalid market price');
  return exponent >= 0
    ? [digits * 10n ** BigInt(exponent), 1n]
    : [digits, 10n ** BigInt(-exponent)];
}

/** Floor the gross payout without floating-point rounding; losses cannot exceed principal. */
export function investmentPayout(
  principal: number,
  multiplier: number,
  opening: string,
  closing: string,
): number {
  if (
    !Number.isSafeInteger(principal) ||
    principal <= 0 ||
    !Number.isSafeInteger(multiplier) ||
    multiplier < 0
  )
    throw new Error('Invalid investment');
  const [openNumerator, openDenominator] = decimal(opening);
  const [closeNumerator, closeDenominator] = decimal(closing);
  const denominator = closeDenominator * openNumerator;
  const change = closeNumerator * openDenominator - denominator;
  const numerator = BigInt(principal) * (denominator + BigInt(multiplier) * change);
  const payout = numerator <= 0n ? 0n : numerator / denominator;
  if (payout > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('Investment payout exceeds safe token range');
  return Number(payout);
}
