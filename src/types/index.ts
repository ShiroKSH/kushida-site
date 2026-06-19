import type { LucideIcon } from "lucide-react";

export type Project = {
  name: string;
  stack: string[];
  status: "active" | "experimental" | "archived";
  type: string;
  url: string;
  detailsUrl: string;
  isPlaceholder?: boolean;
  metric: string;
  visual: "desktop" | "server" | "plugin" | "bot" | "automation" | "utility";
};

export type TechItem = {
  name: string;
  group: string;
  signal: string;
  hours: string;
};

export type LiveWidget = {
  label: string;
  value: string;
  detail: string;
  tone: "cyan" | "red" | "violet" | "green" | "amber";
};

export type NavItem = {
  label: string;
  href: string;
};

export type CardIcon = LucideIcon;

export type Locale = "en" | "ru" | "fr" | "jp";

export type WeatherCondition =
  | "clear"
  | "fair"
  | "cloudy"
  | "overcast"
  | "misty"
  | "drizzle"
  | "rain"
  | "storm"
  | "snow"
  | "night";

export type LocationPreset = {
  id: string;
  label: string;
  shortLabel: string;
  latitude: number;
  longitude: number;
  timeZone: string;
  offset: string;
};

export type WeatherSnapshot = {
  ok: boolean;
  mode: "live" | "fallback";
  condition: WeatherCondition;
  label: string;
  temperature: number;
  humidity: number;
  windSpeed: number;
  windDirection: number;
  precipitation: number;
  weatherCode: number;
  cloudCover: number;
  isDay: boolean;
  time: string;
  timeZone: string;
};

export type GitHubSnapshot = {
  ok: boolean;
  mode: "live" | "fallback";
  username: string;
  commits: number;
  repositories: number;
  followers: number;
  lastPushAt: string | null;
  lastPushLabel: string;
  graph: number[];
};
