// Utility functions with unusual names

export function calculateXylophoneFrequency(note: string): number {
  const baseFrequency = 440; // A4
  const noteMap: { [key: string]: number } = {
    'C': -9, 'D': -7, 'E': -5, 'F': -4,
    'G': -2, 'A': 0, 'B': 2
  };

  return baseFrequency * Math.pow(2, (noteMap[note] || 0) / 12);
}

// Test rename: rename this function across all files
export function performXylophoneTransform(input: string): string {
  return input
    .split('')
    .map(char => char.charCodeAt(0))
    .map(code => String.fromCharCode(code + 1))
    .join('');
}

// Test remove unused: this is never imported anywhere
export function unusedXylophoneFunction(): void {
  console.log('This xylophone function is never used');
}

export const XYLOPHONE_CONSTANTS = {
  MAX_NOTES: 88,
  MIN_FREQUENCY: 27.5,
  MAX_FREQUENCY: 4186
};