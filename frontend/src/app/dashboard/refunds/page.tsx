"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCurrency, formatDate } from "@/lib/utils";

interface Refund {
  id: string;
  refund_id: string;
  payment_id: string;
  amount: number;
  currency: string;
  reason: string;
  status: string;
  created_at: string;
}

export default function RefundsPage() {
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [loading, setLoading] = useState(true);
  const [paymentID, setPaymentID] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    try {
      const d = await api.get<{ refunds: Refund[] }>("/v1/client/refunds");
      setRefunds(d.refunds || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function createRefund(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await api.post("/v1/client/refunds", {
        payment_id: paymentID,
        amount: parseInt(amount),
        reason,
      });
      setPaymentID(""); setAmount(""); setReason("");
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Refunds</h1>
        <p className="text-gray-500 text-sm mt-1">Manage payment refunds</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <h3 className="font-medium text-gray-900 mb-3">Request Refund</h3>
        <form onSubmit={createRefund} className="flex space-x-3">
          {error && <div className="text-red-600 text-sm">{error}</div>}
          <input value={paymentID} onChange={e => setPaymentID(e.target.value)}
            placeholder="Payment ID (UUID)" className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" required />
          <input value={amount} onChange={e => setAmount(e.target.value)}
            placeholder="Amount in paise" type="number" className="w-32 px-3 py-2 border border-gray-300 rounded-lg text-sm" required />
          <input value={reason} onChange={e => setReason(e.target.value)}
            placeholder="Reason" className="w-40 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          <button type="submit" disabled={submitting}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
            {submitting ? "..." : "Refund"}
          </button>
        </form>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="divide-y divide-gray-50">
          {refunds.length === 0 && <div className="px-6 py-8 text-center text-gray-400">No refunds</div>}
          {refunds.map(r => (
            <div key={r.id} className="px-6 py-4 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">{r.refund_id}</div>
                <div className="text-xs text-gray-400">{r.reason || "No reason"} · {formatDate(r.created_at)}</div>
              </div>
              <div className="flex items-center space-x-3">
                <span className="text-sm">{formatCurrency(r.amount)}</span>
                <StatusBadge status={r.status} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
