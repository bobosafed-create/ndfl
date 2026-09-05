import LegalDocumentsClient from "./LegalDocumentsClient";
import { DEFAULT_LEGAL_DOCUMENTS } from "../../lib/legal-documents.mjs";

export default function LegalPage() {
  return <main className="legal-page"><LegalDocumentsClient initialDocuments={DEFAULT_LEGAL_DOCUMENTS} /></main>;
}
