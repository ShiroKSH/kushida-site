import type { LocationPreset } from "@/types";

export const locationPresets: LocationPreset[] = [
  {
    id: "ksh",
    label: "KSH / Moscow",
    shortLabel: "KSH",
    latitude: 55.7558,
    longitude: 37.6173,
    timeZone: "Europe/Moscow",
    offset: "GMT+3",
  },
  {
    id: "frankfurt",
    label: "Frankfurt am Main",
    shortLabel: "FRA",
    latitude: 50.1109,
    longitude: 8.6821,
    timeZone: "Europe/Berlin",
    offset: "GMT+2",
  },
  {
    id: "tokyo",
    label: "Tokyo",
    shortLabel: "TYO",
    latitude: 35.6762,
    longitude: 139.6503,
    timeZone: "Asia/Tokyo",
    offset: "JST",
  },
  {
    id: "new-york",
    label: "New York",
    shortLabel: "NYC",
    latitude: 40.7128,
    longitude: -74.006,
    timeZone: "America/New_York",
    offset: "EST",
  },
  {
    id: "london",
    label: "London",
    shortLabel: "LDN",
    latitude: 51.5072,
    longitude: -0.1276,
    timeZone: "Europe/London",
    offset: "GMT",
  },
  {
    id: "seoul",
    label: "Seoul",
    shortLabel: "SEL",
    latitude: 37.5665,
    longitude: 126.978,
    timeZone: "Asia/Seoul",
    offset: "KST",
  },
  {
    id: "sydney",
    label: "Sydney",
    shortLabel: "SYD",
    latitude: -33.8688,
    longitude: 151.2093,
    timeZone: "Australia/Sydney",
    offset: "AEDT",
  },
];

export function getLocationByTimeZone(timeZone: string | undefined) {
  return (
    locationPresets.find((location) => location.timeZone === timeZone) ??
    locationPresets[0]
  );
}
