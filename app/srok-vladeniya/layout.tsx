import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Минимальный срок владения квартирой — НДФЛ.просто",
  description: "Проверьте, правильно ли определена дата начала владения и действительно ли при продаже квартиры нужно платить НДФЛ.",
  openGraph: {
    title: "Когда налог с продажи квартиры может быть равен 0 ₽",
    description: "Наследство, приватизация и единственное жильё: проверьте минимальный срок владения до уплаты НДФЛ.",
    type: "website",
  },
};

export default function OwnershipPeriodLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
