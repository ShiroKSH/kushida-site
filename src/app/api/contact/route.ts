import { NextResponse } from "next/server";

export const runtime = "nodejs";

const lastContactByIp = new Map<string, number>();
const contactCooldownMs = 15_000;

function secret(name: "TELEGRAM_BOT_TOKEN" | "TELEGRAM_CHAT_ID") {
  const scopedName = `KUSHIDA_${name}` as const;
  return process.env[scopedName] ?? process.env[name] ?? "";
}

function clientIp(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "local"
  );
}

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function chatIds() {
  return secret("TELEGRAM_CHAT_ID")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatMoscowTime(date: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  const name = clean(body?.name, 80);
  const contact = clean(body?.contact, 120);
  const message = clean(body?.message, 1500);
  const website = clean(body?.website, 120);

  if (website) {
    return NextResponse.json({ ok: false, error: "Validation failed" }, { status: 422 });
  }

  if (name.length < 1 || contact.length < 2 || message.length < 2) {
    return NextResponse.json({ ok: false, error: "Validation failed" }, { status: 422 });
  }

  const ip = clientIp(request);
  const lastContact = lastContactByIp.get(ip) ?? 0;
  if (Date.now() - lastContact < contactCooldownMs) {
    return NextResponse.json({ ok: false, error: "Rate limited" }, { status: 429 });
  }

  const token = secret("TELEGRAM_BOT_TOKEN");
  const targets = chatIds();
  if (!token || targets.length === 0) {
    return NextResponse.json({ ok: false, error: "Telegram is not configured" }, { status: 500 });
  }

  const text = [
    "Новая заявка с kushida.tech",
    "",
    `Имя: ${name}`,
    `Контакт: ${contact}`,
    `Время: ${formatMoscowTime(new Date())} МСК`,
    "",
    message,
  ].join("\n");

  const results = await Promise.allSettled(
    targets.map(async (chatId) => {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          chat_id: chatId,
          text,
          disable_web_page_preview: "true",
        }),
      });

      const result = (await response.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
      if (!response.ok || result?.ok !== true) {
        throw new Error(result?.description || `telegram-${response.status}`);
      }
    }),
  );

  if (!results.some((result) => result.status === "fulfilled")) {
    return NextResponse.json({ ok: false, error: "Telegram rejected the message" }, { status: 502 });
  }

  lastContactByIp.set(ip, Date.now());
  return NextResponse.json({ ok: true });
}
