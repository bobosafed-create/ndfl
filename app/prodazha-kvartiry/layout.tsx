import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "НДФЛ при продаже квартиры: срок, расчёт и 3-НДФЛ — НДФЛ.просто",
  description: "Что проверить после продажи квартиры: минимальный срок владения, кадастровую стоимость, расходы, вычет, декларацию и сроки уплаты НДФЛ.",
  alternates: { canonical: "/prodazha-kvartiry" },
  openGraph: {
    title: "Продали квартиру? Проверьте НДФЛ до подачи декларации",
    description: "Понятный маршрут: срок владения, налоговая база, расходы, вычет и необходимость подачи 3-НДФЛ.",
    type: "website",
  },
};

const structuredData = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  "@id": "https://ndfl-prosto.ru/prodazha-kvartiry#webpage",
  url: "https://ndfl-prosto.ru/prodazha-kvartiry",
  name: "НДФЛ при продаже квартиры: срок, расчёт и 3-НДФЛ",
  description: "Что проверить после продажи квартиры: срок владения, налоговую базу, расходы, вычет и необходимость подачи 3-НДФЛ.",
  inLanguage: "ru-RU",
  isPartOf: { "@id": "https://ndfl-prosto.ru/#website" },
  about: { "@type": "Thing", name: "НДФЛ при продаже квартиры" },
};

export default function ApartmentSaleLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />{children}</>;
}
