/** Count declarations by distinct app, never by duplicate entries or execution. */
export function capabilityUsage(apps: { id: string; capabilityIds: string[] }[]) {
  const users = new Map<string, Set<string>>();
  for (const app of apps) for (const id of app.capabilityIds) {
    if (!users.has(id)) users.set(id, new Set());
    users.get(id)!.add(app.id);
  }
  return new Map([...users].map(([id, apps]) => [id, apps.size]));
}

export function isRecentRegistration(iso: string | null, now: number, days: number) {
  if (!iso) return false;
  const time = Date.parse(iso);
  return Number.isFinite(time) && time <= now && time >= now - days * 86_400_000;
}
