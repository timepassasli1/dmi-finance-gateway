"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";

interface LedgerEntry {
  id: string;
  entry_type: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  reference: string;
  description: string;
  created_at: string;
}

export default function LedgerPage() {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<{ entries: LedgerEntry[]; total: number }>("/v1/client/wallet/ledger?limit=50")
      .then(d => { setEntries(d.entries || []); setTotal(d.total); })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Ledger</h1>
        <p className="text-gray-500 text-sm mt-1">{total} total entries — append-only audit trail</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Amount</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Balance Before</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Balance After</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Reference</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {entries.length === 0 && (
                <tr><td colSpan={6} className="text-center py-12 text-gray-400">No ledger entries</td></tr>
              )}
              {entries.map(e => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium
                      ${e.entry_type === "CREDIT" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                      {e.entry_type}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm font-medium">
                    <span className={e.entry_type === "CREDIT" ? "text-green-600" : "text-red-600"}>
                      {e.entry_type === "CREDIT" ? "+" : "-"}{formatCurrency(e.amount)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">{formatCurrency(e.balance_before)}</td>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">{formatCurrency(e.balance_after)}</td>
                  <td className="px-6 py-4"><code className="text-xs text-gray-500">{e.reference || "-"}</code></td>
                  <td className="px-6 py-4 text-xs text-gray-400">{formatDate(e.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
