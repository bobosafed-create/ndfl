import type { Metadata } from "next";
import { YANDEX_METRIKA_ID } from "../lib/metrika";
import "./globals.css";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  "https://ndfl-prosto-help.bobosafed.chatgpt.site";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Проверьте свой НДФЛ — НДФЛ.просто",
  description: "Проверка НДФЛ, необходимости 3-НДФЛ, права на уменьшение налога и возврат. Персональный расчёт и письменные рекомендации.",
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
