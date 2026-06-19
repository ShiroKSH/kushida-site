import { NextRequest, NextResponse } from "next/server";
import type { WeatherCondition, WeatherSnapshot } from "@/types";

type OpenMeteoCurrent = {
  time?: string;
  temperature_2m?: number;
  relative_humidity_2m?: number;
  is_day?: number;
  precipitation?: number;
  rain?: number;
  showers?: number;
  snowfall?: number;
  weather_code?: number;
  cloud_cover?: number;
  wind_speed_10m?: number;
  wind_direction_10m?: number;
};

function classifyWeather(code: number, isDay: boolean): { condition: WeatherCondition; label: string } {
  if (!isDay && code <= 3) return { condition: "night", label: "Night" };
  if (code === 0) return { condition: "clear", label: "Clear" };
  if (code <= 2) return { condition: "fair", label: "Fair" };
  if (code === 3) return { condition: "overcast", label: "Overcast" };
  if (code === 45 || code === 48) return { condition: "misty", label: "Mist" };
  if ([51, 53, 55, 56, 57].includes(code)) return { condition: "drizzle", label: "Drizzle" };
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { condition: "rain", label: "Rain" };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { condition: "snow", label: "Snow" };
  if ([95, 96, 99].includes(code)) return { condition: "storm", label: "Storm" };
  return { condition: "cloudy", label: "Cloudy" };
}

function fallback(timeZone: string): WeatherSnapshot {
  return {
    ok: false,
    mode: "fallback",
    condition: "overcast",
    label: "Overcast",
    temperature: 14,
    humidity: 56,
    windSpeed: 2,
    windDirection: 225,
    precipitation: 0,
    weatherCode: 3,
    cloudCover: 82,
    isDay: false,
    time: new Date().toISOString(),
    timeZone,
  };
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const latitude = Number(params.get("lat"));
  const longitude = Number(params.get("lon"));
  const timeZone = params.get("tz") || "Europe/Moscow";

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return NextResponse.json(fallback(timeZone), { status: 400 });
  }

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set(
    "current",
    [
      "temperature_2m",
      "relative_humidity_2m",
      "is_day",
      "precipitation",
      "rain",
      "showers",
      "snowfall",
      "weather_code",
      "cloud_cover",
      "wind_speed_10m",
      "wind_direction_10m",
    ].join(","),
  );
  url.searchParams.set("timezone", timeZone);
  url.searchParams.set("forecast_days", "1");
  url.searchParams.set("temperature_unit", "celsius");
  url.searchParams.set("wind_speed_unit", "kmh");
  url.searchParams.set("precipitation_unit", "mm");

  try {
    const response = await fetch(url, {
      next: { revalidate: 900 },
      headers: { accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Open-Meteo ${response.status}`);
    }

    const data = (await response.json()) as { current?: OpenMeteoCurrent };
    const current = data.current ?? {};
    const weatherCode = Math.round(current.weather_code ?? 3);
    const isDay = current.is_day === 1;
    const classified = classifyWeather(weatherCode, isDay);

    return NextResponse.json({
      ok: true,
      mode: "live",
      condition: classified.condition,
      label: classified.label,
      temperature: Math.round(current.temperature_2m ?? 14),
      humidity: Math.round(current.relative_humidity_2m ?? 56),
      windSpeed: Math.round(current.wind_speed_10m ?? 2),
      windDirection: Math.round(current.wind_direction_10m ?? 225),
      precipitation: Number((current.precipitation ?? current.rain ?? current.showers ?? current.snowfall ?? 0).toFixed(1)),
      weatherCode,
      cloudCover: Math.round(current.cloud_cover ?? 82),
      isDay,
      time: current.time ?? new Date().toISOString(),
      timeZone,
    } satisfies WeatherSnapshot);
  } catch {
    return NextResponse.json(fallback(timeZone));
  }
}
