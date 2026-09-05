import type { ReactNode } from "react";

function inline(text: string): ReactNode[] {
  const pattern = /(\*\*[^*]+\*\*|\[[^\]]+\]\((?:https?:\/\/|mailto:|tel:)[^)]+\))/g;
  return text.split(pattern).filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    const link = part.match(/^\[([^\]]+)\]\(((?:https?:\/\/|mailto:|tel:)[^)]+)\)$/);
    if (link) return <a key={index} href={link[2]}>{link[1]}</a>;
    return part;
  });
}

export default function LegalDocumentContent({ body }: { body: string }) {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) { index += 1; continue; }
    if (line.startsWith("### ")) { blocks.push(<h4 key={`h4-${index}`}>{inline(line.slice(4))}</h4>); index += 1; continue; }
    if (line.startsWith("## ")) { blocks.push(<h3 key={`h3-${index}`}>{inline(line.slice(3))}</h3>); index += 1; continue; }
    if (/^-\s+/.test(line)) {
      const items: ReactNode[] = [];
      const start = index;
      while (index < lines.length && /^-\s+/.test(lines[index].trim())) { items.push(<li key={index}>{inline(lines[index].trim().replace(/^-\s+/, ""))}</li>); index += 1; }
      blocks.push(<ul key={`ul-${start}`}>{items}</ul>);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: ReactNode[] = [];
      const start = index;
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) { items.push(<li key={index}>{inline(lines[index].trim().replace(/^\d+\.\s+/, ""))}</li>); index += 1; }
      blocks.push(<ol key={`ol-${start}`}>{items}</ol>);
      continue;
    }
    const paragraph = [line];
    const start = index;
    index += 1;
    while (index < lines.length && lines[index].trim() && !/^(?:## |### |-\s+|\d+\.\s+)/.test(lines[index].trim())) { paragraph.push(lines[index].trim()); index += 1; }
    blocks.push(<p key={`p-${start}`}>{inline(paragraph.join(" "))}</p>);
  }
  return <>{blocks}</>;
}
