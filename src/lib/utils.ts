export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function clampText(value: string, max = 120) {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}
