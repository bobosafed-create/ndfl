import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Правовая информация — НДФЛ.просто",
  description: "Публичная оферта, условия конфиденциальности, возврата денег и контакты сервиса НДФЛ.просто.",
  alternates: { canonical: "/legal" },
};

export default function LegalLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
