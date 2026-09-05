"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import LegalDocumentContent from "./LegalDocumentContent";

type Version = { revision: number; title: string; footerLabel: string; body: string; status: "draft" | "published"; showInFooter: boolean; sortOrder: number; createdAt: string };
type DocumentItem = { id: string; slug: string; title: string; footerLabel: string; body: string; status: "draft" | "published"; showInFooter: boolean; sortOrder: number; isSystem: boolean; revision: number; publishedRevision: number | null; publishedAt: string | null; updatedAt: string; versions: Version[] };
type Draft = { slug: string; title: string; footerLabel: string; body: string; showInFooter: boolean; sortOrder: number };

const emptyDraft: Draft = { slug: "", title: "", footerLabel: "", body: "", showInFooter: true, sortOrder: 100 };

export default function LegalDocumentsAdmin({ consultantToken }: { consultantToken: string }) {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [creating, setCreating] = useState(false);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const selected = useMemo(() => documents.find((item) => item.id === selectedId) ?? null, [documents, selectedId]);

  const load = useCallback(async (preferredId?: string) => {
    const response = await fetch("/api/consultant/legal-documents", { headers: { authorization: `Bearer ${consultantToken}` }, cache: "no-store" });
    if (!response.ok) throw new Error("load_failed");
    const result = await response.json();
    const items: DocumentItem[] = Array.isArray(result.documents) ? result.documents : [];
    setDocuments(items);
    const nextId = preferredId && items.some((item) => item.id === preferredId) ? preferredId : items[0]?.id ?? "";
    setSelectedId(nextId);
    const item = items.find((entry) => entry.id === nextId);
    if (item) setDraft({ slug: item.slug, title: item.title, footerLabel: item.footerLabel, body: item.body, showInFooter: item.showInFooter, sortOrder: item.sortOrder });
  }, [consultantToken]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load().catch(() => setMessage("Не удалось загрузить документы.")); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function choose(item: DocumentItem) {
    setCreating(false); setPreview(false); setSelectedId(item.id); setMessage("");
    setDraft({ slug: item.slug, title: item.title, footerLabel: item.footerLabel, body: item.body, showInFooter: item.showInFooter, sortOrder: item.sortOrder });
  }

  async function submit(action: "save" | "publish") {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/consultant/legal-documents", {
        method: creating ? "POST" : "PATCH",
        headers: { authorization: `Bearer ${consultantToken}`, "content-type": "application/json" },
        body: JSON.stringify(creating ? draft : { ...draft, id: selectedId, action }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "save_failed");
      const id = result.document?.id ?? selectedId;
      setCreating(false);
      await load(id);
      setMessage(creating ? "Документ создан как черновик." : action === "publish" ? "Новая редакция опубликована на сайте." : "Черновик сохранён. Опубликованная редакция не изменилась.");
    } catch (error) {
      setMessage(error instanceof Error && error.message === "slug_exists" ? "Такой адрес документа уже используется." : "Не удалось сохранить документ. Проверьте поля и повторите попытку.");
    } finally { setBusy(false); }
  }

  async function restore(revision: number) {
    if (!selected) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/consultant/legal-documents/restore", {
        method: "POST",
        headers: { authorization: `Bearer ${consultantToken}`, "content-type": "application/json" },
        body: JSON.stringify({ documentId: selected.id, revision }),
      });
      if (!response.ok) throw new Error("restore_failed");
      await load(selected.id);
      setMessage(`Редакция №${revision} восстановлена как новый черновик. Для показа посетителям нажмите «Опубликовать».`);
    } catch { setMessage("Не удалось восстановить редакцию."); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!selected || selected.isSystem || !window.confirm(`Удалить документ «${selected.title}» и всю историю его редакций?`)) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/consultant/legal-documents", {
        method: "DELETE",
        headers: { authorization: `Bearer ${consultantToken}`, "content-type": "application/json" },
        body: JSON.stringify({ id: selected.id }),
      });
      if (!response.ok) throw new Error("delete_failed");
      await load();
      setMessage("Документ удалён.");
    } catch { setMessage("Не удалось удалить документ."); }
    finally { setBusy(false); }
  }

  const valid = draft.title.trim().length >= 3 && draft.footerLabel.trim().length >= 2 && draft.body.trim().length >= 20 && (!creating || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.slug));

  return <section className="legal-admin" aria-labelledby="legal-admin-title">
    <div className="legal-admin-heading"><div><span className="mini-label">Содержание сайта</span><h2 id="legal-admin-title">Документы сайта</h2><p>Сохраняйте изменения как черновик, проверяйте результат и только затем публикуйте.</p></div><button type="button" onClick={() => { setCreating(true); setSelectedId(""); setDraft(emptyDraft); setPreview(false); setMessage(""); }}>+ Новый документ</button></div>
    {message && <p className="legal-admin-message" role="status">{message}</p>}
    <div className="legal-admin-workspace">
      <nav aria-label="Документы сайта">{documents.map((item) => <button type="button" key={item.id} className={item.id === selectedId && !creating ? "selected" : ""} onClick={() => choose(item)}><b>{item.footerLabel}</b><span>{item.publishedRevision ? item.status === "draft" ? "Есть неопубликованный черновик" : "Опубликован" : "Только черновик"}</span></button>)}</nav>
      <div className="legal-admin-editor">
        <div className="legal-admin-status"><b>{creating ? "Новый документ" : selected?.isSystem ? "Основной документ · удаление защищено" : "Дополнительный документ"}</b>{!creating && selected?.publishedAt && <span>Опубликован: {new Date(selected.publishedAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>}</div>
        {creating && <label>Адрес документа латиницей<input value={draft.slug} maxLength={64} placeholder="naprimer-pamyatka" onChange={(event) => setDraft((current) => ({ ...current, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }))}/><small>После создания адрес изменить нельзя.</small></label>}
        <div className="legal-admin-fields"><label>Полное название<input value={draft.title} maxLength={160} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}/></label><label>Название ссылки в подвале<input value={draft.footerLabel} maxLength={80} onChange={(event) => setDraft((current) => ({ ...current, footerLabel: event.target.value }))}/></label><label>Порядок<input type="number" min="0" max="999" value={draft.sortOrder} onChange={(event) => setDraft((current) => ({ ...current, sortOrder: Number(event.target.value) }))}/></label></div>
        <label className="legal-admin-footer-check"><input type="checkbox" checked={draft.showInFooter} onChange={(event) => setDraft((current) => ({ ...current, showInFooter: event.target.checked }))}/><span>Показывать ссылку на документ в подвале сайта</span></label>
        <div className="legal-admin-tabs"><button type="button" className={!preview ? "active" : ""} onClick={() => setPreview(false)}>Редактирование</button><button type="button" className={preview ? "active" : ""} onClick={() => setPreview(true)}>Предпросмотр</button></div>
        {preview ? <article className="legal-admin-preview"><h2>{draft.title || "Название документа"}</h2><LegalDocumentContent body={draft.body || "Текст документа появится здесь."}/></article> : <><label>Текст документа<textarea value={draft.body} maxLength={30000} rows={22} onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))}/></label><p className="legal-format-help"><b>Оформление:</b> <code>## Заголовок</code>, <code>**жирный текст**</code>, <code>- пункт списка</code>, <code>1. пункт</code>, <code>[название](https://адрес.ru)</code>.</p></>}
        <div className="legal-admin-actions"><button type="button" disabled={!valid || busy} onClick={() => void submit("save")}>{busy ? "Сохраняем…" : creating ? "Создать черновик" : "Сохранить черновик"}</button>{!creating && <button className="publish" type="button" disabled={!valid || busy} onClick={() => void submit("publish")}>Опубликовать</button>}{selected && !selected.isSystem && !creating && <button className="delete" type="button" disabled={busy} onClick={() => void remove()}>Удалить</button>}</div>
        {selected && !creating && selected.versions.length > 0 && <details className="legal-admin-history"><summary>История редакций ({selected.versions.length})</summary>{selected.versions.map((version) => <div key={version.revision}><span><b>Редакция №{version.revision}</b> · {version.status === "published" ? "опубликована" : "черновик"}<small>{new Date(version.createdAt).toLocaleString("ru-RU")}</small></span><button type="button" disabled={busy || version.revision === selected.revision} onClick={() => void restore(version.revision)}>Восстановить</button></div>)}</details>}
      </div>
    </div>
  </section>;
}
