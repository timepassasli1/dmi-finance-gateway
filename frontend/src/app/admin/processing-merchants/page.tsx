"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";

interface Merchant {
  id: string;
  merchant_code: string;
  display_name: string;
  provider: string;
  status: string;
  upi_vpa?: string;
  paytm_mid?: string;
  daily_limit: number;
  transaction_limit: number;
}

export default function ProcessingMerchantsPage() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ merchant_code: "", display_name: "", provider: "mock", upi_vpa: "", paytm_mid: "", daily_limit: 0, transaction_limit: 0 });
  const [creating, setCreating] = useState(false);

  async function load() {
    try {
      const d = await api.get<{ processing_merchants: Merchant[] }>("/v1/admin/processing-merchants");
      setMerchants(d.processing_merchants || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function create() {
    setCreating(true);
    try {
      await api.post("/v1/admin/processing-merchants", form);
      setForm({ merchant_code: "", display_name: "", provider: "mock", upi_vpa: "", paytm_mid: "", daily_limit: 0, transaction_limit: 0 });
      load();
    } finally {
      setCreating(false);
    }
  }

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Processing Merchants</h1>
        <p className="text-gray-500 text-sm mt-1">Configure payment processing backends (admin only)</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <h3 className="font-medium text-gray-900 mb-3">Create Processing Merchant</h3>
        <div className="grid grid-cols-2 gap-3">
          <input value={form.merchant_code} onChange={e => setForm(f => ({...f, merchant_code: e.target.value}))}
            placeholder="Merchant Code (e.g. PM_001)"
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <input value={form.display_name} onChange={e => setForm(f => ({...f, display_name: e.target.value}))}
            placeholder="Display Name"
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <input value={form.upi_vpa} onChange={e => setForm(f => ({...f, upi_vpa: e.target.value}))}
            placeholder="UPI VPA (e.g. shop@paytm)"
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <input value={form.paytm_mid} onChange={e => setForm(f => ({...f, paytm_mid: e.target.value}))}
            placeholder="Paytm MID"
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <select value={form.provider} onChange={e => setForm(f => ({...f, provider: e.target.value}))}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="mock">Mock (Development)</option>
            <option value="razorpay">Razorpay</option>
            <option value="cashfree">Cashfree</option>
            <option value="payu">PayU</option>
          </select>
          <div className="flex space-x-2">
            <input value={form.transaction_limit} onChange={e => setForm(f => ({...f, transaction_limit: parseInt(e.target.value)}))}
              placeholder="Max txn (paise)" type="number"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            <button onClick={create} disabled={creating || !form.merchant_code || !form.display_name}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
              {creating ? "..." : "Create"}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Name</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Code</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Provider</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">UPI VPA</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {merchants.length === 0 && (
              <tr><td colSpan={5} className="text-center py-12 text-gray-400">No processing merchants configured</td></tr>
            )}
            {merchants.map(m => (
              <tr key={m.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 font-medium text-sm text-gray-900">{m.display_name}</td>
                <td className="px-6 py-4"><code className="text-xs text-gray-600">{m.merchant_code}</code></td>
                <td className="px-6 py-4 text-sm text-gray-500">{m.provider}</td>
                <td className="px-6 py-4"><code className="text-xs text-gray-600">{m.upi_vpa || "-"}</code></td>
                <td className="px-6 py-4"><StatusBadge status={m.status} /></td>
                <td className="px-6 py-4">
                  <button onClick={() => api.post(`/v1/admin/processing-merchants/${m.id}/status`, { status: m.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }).then(load)}
                    className="text-xs text-blue-600 hover:underline">
                    {m.status === "ACTIVE" ? "Deactivate" : "Activate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
