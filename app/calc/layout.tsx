import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Предварительный расчёт НДФЛ при продаже квартиры — НДФЛ.просто",
  description: "Предварительно рассчитайте НДФЛ при продаже квартиры и проверьте обстоятельства, которые могут изменить налог.",
  openGraph: {
    title: "Калькулятор НДФЛ при продаже квартиры",
    description: "Предварительный расчёт налога и проверка возможных льгот и вычетов.",
    type: "website",
  },
};

export default function CalculatorLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
