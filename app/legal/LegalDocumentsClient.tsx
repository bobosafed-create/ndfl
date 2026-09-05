"use client";

import { useEffect, useMemo, useState } from "react";
import LegalDocumentContent from "../../components/LegalDocumentContent";

type LegalDocument = { id: string; slug: string; title: string; footerLabel: string; body: string; showInFooter: boolean; updatedAt: string };

export default function LegalDocumentsClient({ initialDocuments }: { initialDocuments: LegalDocument[] }) {
  const [documents, setDocuments] = useState(initialDocuments);
  useEffect(() => {
    let active = true;
    fetch("/api/legal-documents", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((result) => {
      if (active && Array.isArray(result?.documents) && result.documents.length > 0) setDocuments(result.documents);
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  const updated = useMemo(() => {
    const latest = documents.reduce((date, item) => { const value = new Date(item.updatedAt); return Number.isNaN(value.getTime()) || value < date ? date : value; }, new Date(0));
    return latest.getTime() === 0 ? "не указана" : latest.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  }, [documents]);
  return <>
    {/* Обычная ссылка надёжно возвращает к комнате после прямого открытия документа. */}
    {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
    <header className="legal-header"><a className="cabinet-back" href="/#room" aria-label="Вернуться на сайт"><span>←</span><b>На сайт</b></a><div><span className="mini-label">Правовая информация</span><h1>Документы и контакты</h1><p>Последнее изменение: {updated}</p></div></header>
    <nav className="legal-nav" aria-label="Разделы">{documents.map((item) => <a href={`#${item.slug}`} key={item.slug}>{item.footerLabel}</a>)}</nav>
    {documents.map((item, index) => <article id={item.slug} className="legal-card" key={item.id}><span className="mini-label">Документ {index + 1}</span><h2>{item.title}</h2><LegalDocumentContent body={item.body} /></article>)}
  </>;
}
