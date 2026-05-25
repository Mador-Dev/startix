import type { ClosedPositionRecord } from "../types/api";

const KEY = "startix_closed_positions";

export function getClosedPositions(): ClosedPositionRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ClosedPositionRecord[]) : [];
  } catch {
    return [];
  }
}

export function saveClosedPosition(record: ClosedPositionRecord): void {
  const existing = getClosedPositions();
  const updated = [record, ...existing].slice(0, 50); // keep last 50
  localStorage.setItem(KEY, JSON.stringify(updated));
}

export function clearClosedPositions(): void {
  localStorage.removeItem(KEY);
}
