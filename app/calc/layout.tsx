import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Предварительный расчёт НДФЛ при продаже квартиры — НДФЛ.просто",
  description: "Узнайте на наглядном примере, как подтверждённые расходы на отделку могут уменьшить НДФЛ при продаже квартиры.",
  openGraph: {
    title: "Калькулятор НДФЛ при продаже квартиры",
    description: "Простой пример экономии на НДФЛ за счёт подтверждённых расходов на отделку.",
    type: "website",
  },
};

export default function CalculatorLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
