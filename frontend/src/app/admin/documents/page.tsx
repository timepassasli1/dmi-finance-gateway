"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate } from "@/lib/utils";

interface Document {
  id: string;
  client_id: string;
  document_type: string;
  file_name: string;
  status: string;
  rejection_reason: string;
  uploaded_at: string;
}

export default function AdminDocumentsPage() {
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const d = await api.get<{ documents: Document[] }>("/v1/admin/documents?status=PENDING");
      setDocs(d.documents || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function review(id: string, status: string) {
    const reason = status === "REJECTED" ? prompt("Rejection reason:") || "" : "";
    await api.post(`/v1/admin/documents/${id}/review`, { status, reason });
    load();
  }

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Document Review</h1>
        <p className="text-gray-500 text-sm mt-1">Review pending client documents</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="divide-y divide-gray-50">
          {docs.length === 0 && (
            <div className="px-6 py-8 text-center text-gray-400">No pending documents</div>
          )}
          {docs.map(d => (
            <div key={d.id} className="px-6 py-4 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-900">{d.document_type.replace(/_/g, " ")}</div>
                <div className="text-xs text-gray-400">{d.file_name} · Client: {d.client_id.slice(0, 8)}...</div>
                <div className="text-xs text-gray-400 mt-0.5">{formatDate(d.uploaded_at)}</div>
              </div>
              <div className="flex items-center space-x-3">
                <StatusBadge status={d.status} />
                <button onClick={() => review(d.id, "APPROVED")} className="bg-green-100 text-green-700 px-3 py-1 rounded text-xs hover:bg-green-200">Approve</button>
                <button onClick={() => review(d.id, "REJECTED")} className="bg-red-100 text-red-700 px-3 py-1 rounded text-xs hover:bg-red-200">Reject</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
