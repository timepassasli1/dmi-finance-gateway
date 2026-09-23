"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCurrency, formatDate } from "@/lib/utils";

interface Wallet {
  id: string;
  client_id: string;
  available_balance: number;
  pending_balance: number;
  currency: string;
  status: string;
  updated_at: string;
}

export default function AdminWalletsPage() {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<{ wallets: Wallet[] }>("/v1/admin/wallets").then(d => setWallets(d.wallets || [])).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Client Wallets</h1>
        <p className="text-gray-500 text-sm mt-1">Internal ledger balances (not bank accounts)</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Client</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Available</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Pending</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {wallets.length === 0 && <tr><td colSpan={5} className="text-center py-12 text-gray-400">No wallets</td></tr>}
            {wallets.map(w => (
              <tr key={w.id}>
                <td className="px-6 py-4 text-sm text-gray-600">{w.client_id.slice(0,8)}...</td>
                <td className="px-6 py-4 text-sm font-medium text-green-600">{formatCurrency(w.available_balance)}</td>
                <td className="px-6 py-4 text-sm text-gray-500">{formatCurrency(w.pending_balance)}</td>
                <td className="px-6 py-4"><StatusBadge status={w.status} /></td>
                <td className="px-6 py-4 text-xs text-gray-400">{formatDate(w.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
