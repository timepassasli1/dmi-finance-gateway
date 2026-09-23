"use client";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCurrency, formatDate } from "@/lib/utils";

interface WatchRow {
  gateway_payment_id: string;
  client_order_id?: string;
  client_id?: string;
  client_email?: string;
  merchant_name?: string;
  amount: number;
  currency: string;
  status: string;
  track_code?: string;
  payment_url?: string;
  last_watched_at?: string;
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

function rowTone(status: string) {
  const s = (status || "").toUpperCase();
  if (s === "SUCCESS") return "bg-emerald-50/40";
  if (s === "FAILED" || s === "EXPIRED") return "bg-red-50/50";
  if (s === "PENDING" || s === "CREATED" || s === "PENDING_REVIEW") return "bg-amber-50/40";
  return "";
}

export default function AdminWatchHistoryPage() {
  const [rows, setRows] = useState<WatchRow[]>([]);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("PENDING");

  async function load() {
    try {
      const data = await api.get<{ payments: WatchRow[] }>("/v1/admin/payments?limit=120");
      setRows(data.payments || []);
      setError("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, []);

  const counts = useMemo(() => {
    const c = { ALL: rows.length, PENDING: 0, SUCCESS: 0, FAILED: 0 };
    for (const r of rows) {
      if (matchesFilter(r.status, "PENDING")) c.PENDING++;
      if (matchesFilter(r.status, "SUCCESS")) c.SUCCESS++;
      if (matchesFilter(r.status, "FAILED")) c.FAILED++;
    }
    return c;
  }, [rows]);

  const visible = useMemo(
    () => rows.filter((r) => matchesFilter(r.status, filter)),
    [rows, filter]
  );

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Watch History</h1>
        <p className="text-sm text-gray-500 mt-1">
          Har user ka link / API payment yahan aata hai. Extension Paytm pe <code className="text-xs bg-slate-100 px-1 rounded">GW</code> match
          karti hai — SUCCESS hone par amount <strong>usi user ke wallet</strong> me credit hota hai.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

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

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs uppercase text-gray-500">
              <th className="px-4 py-3">Shop / User</th>
              <th className="px-4 py-3">GW track</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Payment</th>
              <th className="px-4 py-3">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-gray-400">
                  No payments
                </td>
              </tr>
            )}
            {visible.map((r) => (
              <tr key={r.gateway_payment_id} className={rowTone(r.status)} data-gw={r.track_code || ""}>
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{r.merchant_name || "—"}</div>
                  <div className="text-xs text-gray-500">{r.client_email}</div>
                </td>
                <td className="px-4 py-3">
                  <code className="text-xs font-semibold text-violet-700">{r.track_code || "—"}</code>
                </td>
                <td className="px-4 py-3 font-semibold tabular-nums">{formatCurrency(r.amount, r.currency)}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-4 py-3">
                  <a className="text-xs text-blue-600 hover:underline" href={r.payment_url} target="_blank" rel="noreferrer">
                    {r.gateway_payment_id}
                  </a>
                </td>
                <td className="px-4 py-3 text-xs text-gray-400">{formatDate(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
