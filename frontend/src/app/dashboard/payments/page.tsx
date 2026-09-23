"use client";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCurrency, formatDate } from "@/lib/utils";
import { payPageUrl } from "@/lib/gateway-config";

interface Payment {
  gateway_payment_id: string;
  gateway_order_id: string;
  client_order_id: string;
  amount: number;
  currency: string;
  status: string;
  provider_transaction_ref: string;
  failure_reason: string;
  created_at: string;
}

type Filter = "ALL" | "PENDING" | "SUCCESS" | "FAILED";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "ALL", label: "All" },
  { id: "PENDING", label: "Pending" },
  { id: "SUCCESS", label: "Success" },
  { id: "FAILED", label: "Failed" },
];

function matchesFilter(status: string, filter: Filter) {
  const s = (status || "").toUpperCase();
  if (filter === "ALL") return true;
  if (filter === "PENDING") return s === "PENDING" || s === "CREATED" || s === "PENDING_REVIEW";
  if (filter === "SUCCESS") return s === "SUCCESS";
  if (filter === "FAILED") return s === "FAILED" || s === "EXPIRED";
  return true;
}

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("ALL");

  useEffect(() => {
    api
      .get<{ payments: Payment[]; total: number }>("/v1/client/payments?limit=50")
      .then((d) => {
        setPayments(d.payments || []);
        setTotal(d.total);
      })
      .finally(() => setLoading(false));
  }, []);

  const counts = useMemo(() => {
    const c = { ALL: payments.length, PENDING: 0, SUCCESS: 0, FAILED: 0 };
    for (const p of payments) {
      if (matchesFilter(p.status, "PENDING")) c.PENDING++;
      if (matchesFilter(p.status, "SUCCESS")) c.SUCCESS++;
      if (matchesFilter(p.status, "FAILED")) c.FAILED++;
    }
    return c;
  }, [payments]);

  const visible = useMemo(
    () => payments.filter((p) => matchesFilter(p.status, filter)),
    [payments, filter]
  );

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Payments</h1>
          <p className="text-gray-500 text-sm mt-1">{total} total payments</p>
        </div>
        <a
          href="/dashboard/payment-links"
          className="rounded-lg bg-[#6726A8] px-4 py-2 text-sm font-semibold text-white hover:opacity-95"
        >
          + Create payment link
        </a>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = filter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
                active
                  ? f.id === "SUCCESS"
                    ? "bg-emerald-600 text-white"
                    : f.id === "FAILED"
                      ? "bg-red-600 text-white"
                      : f.id === "PENDING"
                        ? "bg-amber-500 text-white"
                        : "bg-slate-900 text-white"
                  : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
              }`}
            >
              {f.label}
              <span className={`ml-1.5 tabular-nums ${active ? "opacity-90" : "text-slate-400"}`}>
                {counts[f.id]}
              </span>
            </button>
          );
        })}
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Payment ID
                </th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Order ID
                </th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Amount
                </th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Status
                </th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Txn Ref
                </th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Date
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {visible.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-gray-400">
                    No payments for this filter
                  </td>
                </tr>
              )}
              {visible.map((p) => (
                <tr key={p.gateway_payment_id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <a
                      href={payPageUrl(p.gateway_payment_id)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-blue-600 hover:underline"
                    >
                      <code>{p.gateway_payment_id}</code>
                    </a>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-xs text-gray-600">{p.client_order_id}</div>
                    <div className="text-xs text-gray-400">{p.gateway_order_id}</div>
                  </td>
                  <td className="px-6 py-4 text-sm font-medium">
                    {formatCurrency(p.amount, p.currency)}
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="px-6 py-4">
                    <code className="text-xs text-gray-500">{p.provider_transaction_ref || "-"}</code>
                  </td>
                  <td className="px-6 py-4 text-xs text-gray-400">{formatDate(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
