"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate } from "@/lib/utils";

interface Document {
  id: string;
  document_type: string;
  file_name: string;
  file_size: number;
  status: string;
  rejection_reason: string;
  uploaded_at: string;
}

const DOC_TYPES = [
  "PAN_CARD",
  "GST_CERTIFICATE",
  "BUSINESS_REGISTRATION",
  "AUTHORIZED_PERSON_ID",
  "BANK_DETAILS",
  "WEBSITE_OWNERSHIP",
  "OTHER",
];

export default function DocumentsPage() {
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [docType, setDocType] = useState(DOC_TYPES[0]);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      const d = await api.get<{ documents: Document[] }>("/v1/client/documents");
      setDocs(d.documents || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function upload() {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("document_type", docType);
      form.append("file", file);
      await api.upload("/v1/client/documents", form);
      setFile(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Documents</h1>
        <p className="text-gray-500 text-sm mt-1">Upload KYC documents for admin approval (required before going live)</p>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg px-4 py-3">{error}</div>
      )}

      <div className="mb-6 bg-white rounded-xl border border-gray-200 p-4 text-sm text-gray-600">
        After approval, generate API keys and follow the{" "}
        <Link href="/dashboard/integration" className="text-blue-600 underline">integration guide</Link>
        {" "}to add payments to your website.
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <h3 className="font-medium text-gray-900 mb-3">Upload Document</h3>
        <div className="flex space-x-3 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Document Type</label>
            <select
              value={docType}
              onChange={e => setDocType(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {DOC_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-xs text-gray-500 mb-1">File (PDF, JPG, PNG)</label>
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={e => setFile(e.target.files?.[0] || null)}
              className="w-full text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-blue-50 file:text-blue-700"
            />
          </div>
          <button
            onClick={upload}
            disabled={!file || uploading}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {uploading ? "Uploading..." : "Upload"}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Uploaded Documents</h3>
        </div>
        <div className="divide-y divide-gray-50">
          {docs.length === 0 && (
            <div className="px-6 py-8 text-center text-gray-400 text-sm">No documents uploaded</div>
          )}
          {docs.map(d => (
            <div key={d.id} className="px-6 py-4 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-900">{d.document_type.replace(/_/g, " ")}</div>
                <div className="text-xs text-gray-400">{d.file_name}</div>
                {d.rejection_reason && (
                  <div className="text-xs text-red-600 mt-0.5">{d.rejection_reason}</div>
                )}
              </div>
              <div className="flex items-center space-x-3">
                <span className="text-xs text-gray-400">{formatDate(d.uploaded_at)}</span>
                <StatusBadge status={d.status} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
