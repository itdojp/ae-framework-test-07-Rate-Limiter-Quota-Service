function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item));
  }

  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sortedEntries = Object.entries(obj)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, stableValue(item)] as const);
    return Object.fromEntries(sortedEntries);
  }

  return value;
}

export function stableHashPayload(payload: unknown): string {
  return JSON.stringify(stableValue(payload));
}
