export function outerFunc(multiplier: number) {
  const base = 10;

  function process(value: number) {
    const result = calculate(value, multiplier, base);
    return result;
  }

  return process(5);
}
function calculate(value: number, multiplier: number, base: number) {
    return value * multiplier + base;
}

