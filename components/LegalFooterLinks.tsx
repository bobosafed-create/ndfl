"use client";

import { useEffect, useState } from "react";
import { DEFAULT_LEGAL_LINKS } from "../lib/legal-documents.mjs";

type LegalLink = { slug: string; footerLabel: string; showInFooter?: boolean };

export default function LegalFooterLinks() {
  const [links, setLinks] = useState<LegalLink[]>(DEFAULT_LEGAL_LINKS);
  useEffect(() => {
    let active = true;
    fetch("/api/legal-documents", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((result) => {
      if (!active || !Array.isArray(result?.documents)) return;
      const published = result.documents.filter((item: LegalLink) => item.showInFooter);
      setLinks(published);
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  return <nav aria-label="Правовая информация">{links.map((item) => <a href={`/legal#${item.slug}`} key={item.slug}>{item.footerLabel}</a>)}</nav>;
}
