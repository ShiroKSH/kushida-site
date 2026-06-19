import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://kushida.tech"),
  title: "Kushida - Developer Hub",
  description:
    "Fullstack developer focused on interfaces, bots, automation, game-server tools and digital systems.",
  applicationName: "Kushida",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Kushida - Developer Hub",
    description:
      "Fullstack developer focused on interfaces, bots, automation, game-server tools and digital systems.",
    url: "https://kushida.tech",
    siteName: "Kushida",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Kushida developer hub preview",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Kushida - Developer Hub",
    description:
      "Fullstack developer focused on interfaces, bots, automation, game-server tools and digital systems.",
    images: ["/og-image.png"],
  },
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/icon.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className="h-full scroll-smooth antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
