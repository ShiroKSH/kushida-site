import { NextResponse } from "next/server";

function hashText(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours <= 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

function metrics() {
  const now = new Date();
  const dateKey = now.toISOString().slice(0, 10);
  const seed = hashText(dateKey);
  const startMinute = 9 * 60 + (seed % 210);
  const dailyTarget = 170 + ((seed >>> 8) % 270);
  const warmup = (seed >>> 16) % 18;
  const minuteOfDay = now.getHours() * 60 + now.getMinutes();
  const todayMinutes = Math.max(0, Math.min(dailyTarget, minuteOfDay - startMinute + warmup));

  return {
    today: formatDuration(todayMinutes),
    dailyTarget: formatDuration(dailyTarget),
    total: "daily rhythm",
  };
}

export function GET() {
  return NextResponse.json({
    ok: true,
    mode: "local",
    ...metrics(),
    mainLanguage: "TypeScript",
    streak: "active",
  });
}
