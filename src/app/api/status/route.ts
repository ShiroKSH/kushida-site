import { NextResponse } from "next/server";
import { statusRows } from "@/data/live";

export function GET() {
  return NextResponse.json({
    ok: true,
    mode: "local",
    services: Object.fromEntries(statusRows),
    systemHealth: 98,
  });
}
