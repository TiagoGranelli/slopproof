export function truncateCodePoints(text: string, maxCodePoints: number): string {
  return Array.from(text.toWellFormed()).slice(0, maxCodePoints).join('')
}
