/**
 * Turns whatever the user typed into a fragment of the stored E.164 number (+66812345678),
 * so "0812345678", "081-234-5678", "081 234" and "+66 81 234 5678" all match.
 * Returns null when there aren't enough digits to be a useful phone search.
 */
export function phoneSearchFragment(input: string): string | null {
  const trimmed = input.trim();
  let digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+66") || (trimmed.startsWith("66") && digits.length >= 11)) {
    digits = digits.slice(2);
  } else if (digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  return digits.length >= 3 ? digits : null;
}
