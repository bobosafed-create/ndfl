import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Проблемы с НДФЛ — вам сюда",
  description: "Понятная консультация по НДФЛ за 100 ₽: задайте вопрос и получите ответ по персональному коду.",
  openGraph: {
    title: "Проблемы с НДФЛ — вам сюда",
    description: "Понятная консультация по НДФЛ за 100 ₽",
    type: "website",
    locale: "ru_RU",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Дверь консультанта и сейф с ответом" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Проблемы с НДФЛ — вам сюда",
    description: "Понятная консультация по НДФЛ за 100 ₽",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
