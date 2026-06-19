import type { LiveWidget } from "@/types";

export const liveWidgets: LiveWidget[] = [
  {
    label: "GitHub stats",
    value: "active repositories",
    detail: "public profile",
    tone: "cyan",
  },
  {
    label: "Coding time",
    value: "today: live",
    detail: "daily counter",
    tone: "violet",
  },
  {
    label: "Current project",
    value: "fullstack tools",
    detail: "interface + automation in progress",
    tone: "red",
  },
  {
    label: "Service uptime",
    value: "99.98%",
    detail: "api online / monitor online",
    tone: "green",
  },
  {
    label: "Discord status",
    value: "online",
    detail: "presence",
    tone: "cyan",
  },
  {
    label: "Server monitoring",
    value: "latency: 42ms",
    detail: "bot online / panel online",
    tone: "green",
  },
  {
    label: "Now listening",
    value: "night build queue",
    detail: "media line",
    tone: "amber",
  },
  {
    label: "Recent commits",
    value: "latest push queued",
    detail: "commit graph",
    tone: "violet",
  },
  {
    label: "System load",
    value: "27%",
    detail: "stable / clean memory",
    tone: "red",
  },
];

export const statusRows = [
  ["api", "online"],
  ["bot", "online"],
  ["monitor", "online"],
  ["latency", "42ms"],
];

export const githubGraph = [
  2, 4, 1, 5, 3, 7, 0, 4, 6, 2, 8, 5, 1, 3, 7, 2, 6, 4, 8, 3, 1, 5, 7, 2,
  4, 6, 3, 8, 5, 2, 7, 4, 1, 6, 3,
];
