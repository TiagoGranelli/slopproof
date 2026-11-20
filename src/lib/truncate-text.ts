/**
 * Takes at most `maxCodePoints` Unicode code points from `text` without splitting UTF-16 surrogate pairs.
 * Plain `String.prototype.slice` cuts by UTF-16 code units, which can split a supplementary-plane character
 * (such as an emoji) into a lone surrogate in DOM text and accessible names.
 */
export function truncateCodePoints(text: string, maxCodePoints: number): string {
  return Array.from(text.toWellFormed()).slice(0, maxCodePoints).join('')
}
