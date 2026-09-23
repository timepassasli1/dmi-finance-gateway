"use client";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCurrency, formatDate } from "@/lib/utils";

interface Payment {
  gateway_payment_id: string;
  client_order_id: string;
  client_id: string;
  client_email?: string;
  merchant_name?: string;
  amount: number;
  currency: string;
  status: string;
  track_code?: string;
  payment_url?: string;
  failure_reason: string;
  created_at: string;
}

type Filter = "" | "PENDING" | "SUCCESS" | "FAILED";

export default function AdminPaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Filter>("");
  const [error, setError] = useState("");

  async function load() {
    try {
      const d = await api.get<{ payments: Payment[]; total: number }>("/v1/admin/payments?limit=120");
      setPayments(d.payments || []);
      setTotal(d.total || 0);
      setError("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, []);

  const visible = useMemo(() => {
    if (!status) return payments;
    return payments.filter((p) => {
      const s = (p.status || "").toUpperCase();
      if (status === "PENDING") return s === "PENDING" || s === "CREATED" || s === "PENDING_REVIEW";
      if (status === "FAILED") return s === "FAILED" || s === "EXPIRED";
      return s === status;
    });
  }, [payments, status]);

  const pending = useMemo(
    () => payments.filter((p) => ["PENDING", "CREATED", "PENDING_REVIEW"].includes((p.status || "").toUpperCase())).length,
    [payments]
  );

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900" data-page="admin-history-v2">All Payments / History</h1>
          <p className="text-gray-500 text-sm mt-1">
            Panel link + API pay page — sab yahan. Extension <code className="text-xs bg-slate-100 px-1 rounded">GW</code> Paytm
            pe match karti hai; SUCCESS par amount <strong>usi shop ke wallet</strong> me jata hai. {total} total · {pending} pending
          </p>
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as Filter)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
        >
          <option value="">All</option>
          <option value="PENDING">Pending</option>
          <option value="SUCCESS">Success</option>
          <option value="FAILED">Failed</option>
        </select>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Shop / User</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">GW track</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Amount</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Payment</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {visible.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-gray-400">
                    No payments
                  </td>
                </tr>
              )}
              {visible.map((p) => (
                <tr key={p.gateway_payment_id} className="hover:bg-gray-50" data-gw={p.track_code || ""}>
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-gray-900">{p.merchant_name || "—"}</div>
                    <div className="text-xs text-gray-500">{p.client_email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <code className="text-xs font-semibold text-violet-700">{p.track_code || "—"}</code>
                  </td>
                  <td className="px-4 py-3 text-sm font-semibold tabular-nums">{formatCurrency(p.amount, p.currency)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="px-4 py-3">
                    <a className="text-xs text-blue-600 hover:underline" href={p.payment_url} target="_blank" rel="noreferrer">
                      {p.gateway_payment_id}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">{formatDate(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
