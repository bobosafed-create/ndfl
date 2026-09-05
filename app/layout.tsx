import type { Metadata } from "next";
import { YANDEX_METRIKA_ID } from "../lib/metrika";
import "./globals.css";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  "https://ndfl-prosto.ru";

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": "https://ndfl-prosto.ru/#website",
      url: "https://ndfl-prosto.ru/",
      name: "НДФЛ.просто",
      description: "Проверка НДФЛ, необходимости подачи 3-НДФЛ и права на налоговые вычеты.",
      inLanguage: "ru-RU",
    },
    {
      "@type": "Person",
      "@id": "https://ndfl-prosto.ru/#consultant",
      name: "Александр Владимирович Холодный",
      jobTitle: "Налоговый консультант",
    },
    {
      "@type": "ProfessionalService",
      "@id": "https://ndfl-prosto.ru/#service-provider",
      name: "НДФЛ.просто",
      url: "https://ndfl-prosto.ru/",
      email: "bobosafed@gmail.com",
      telephone: "+7-999-426-05-91",
      founder: { "@id": "https://ndfl-prosto.ru/#consultant" },
      areaServed: { "@type": "Country", name: "Россия" },
    },
    {
      "@type": "Service",
      "@id": "https://ndfl-prosto.ru/#tax-consultation",
      name: "Персональная консультация по НДФЛ",
      description: "Письменная проверка налоговой ситуации, расчёт НДФЛ и рекомендации для физических лиц.",
      serviceType: "Консультация по НДФЛ",
      provider: { "@id": "https://ndfl-prosto.ru/#service-provider" },
      areaServed: { "@type": "Country", name: "Россия" },
      offers: [
        { "@type": "Offer", name: "Проверка ситуации", price: "390", priceCurrency: "RUB", url: "https://ndfl-prosto.ru/#pricing-heading" },
        { "@type": "Offer", name: "Расчёт и подробный разбор", price: "990", priceCurrency: "RUB", url: "https://ndfl-prosto.ru/#pricing-heading" },
      ],
    },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Проверьте свой НДФЛ — НДФЛ.просто",
  description: "Проверка НДФЛ, необходимости 3-НДФЛ, права на уменьшение налога и возврат. Персональный расчёт и письменные рекомендации.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Проверьте свой НДФЛ — НДФЛ.просто",
    description: "Расчёт, проверка, налоговые вычеты и персональная консультация по НДФЛ.",
    type: "website",
    locale: "ru_RU",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Дверь консультанта и сейф с ответом" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Проверьте свой НДФЛ — НДФЛ.просто",
    description: "Расчёт, проверка, налоговые вычеты и персональная консультация по НДФЛ.",
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
      <head>
        <meta name="yandex-verification" content="f621b7b1fac1315f" />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,'script','https://mc.yandex.ru/metrika/tag.js?id=${YANDEX_METRIKA_ID}','ym');ym(${YANDEX_METRIKA_ID},'init',{ssr:true,clickmap:true,ecommerce:'dataLayer',referrer:document.referrer,url:location.href,accurateTrackBounce:true,trackLinks:true,webvisor:false});`,
          }}
        />
      </head>
      <body>
        <noscript><div><img src={`https://mc.yandex.ru/watch/${YANDEX_METRIKA_ID}`} style={{ position: "absolute", left: "-9999px" }} alt="" /></div></noscript>
        {children}
      </body>
    </html>
  );
}
