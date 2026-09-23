"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";

interface Route {
  id: string;
  client_id: string;
  processing_merchant_id: string;
  merchant_code: string;
  merchant_display_name: string;
  provider: string;
  priority: number;
  status: string;
  transaction_limit: number;
}

interface Client { id: string; business_name: string; client_code: string; }
interface Merchant { id: string; merchant_code: string; display_name: string; }

export default function RoutesPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [form, setForm] = useState({ client_id: "", processing_merchant_id: "", priority: 1, transaction_limit: 0 });
  const [loading, setLoading] = useState(true);
  const [selectedClient, setSelectedClient] = useState("");

  useEffect(() => {
    Promise.all([
      api.get<{ clients: Client[] }>("/v1/admin/clients"),
      api.get<{ processing_merchants: Merchant[] }>("/v1/admin/processing-merchants"),
    ]).then(([c, m]) => {
      setClients(c.clients || []);
      setMerchants(m.processing_merchants || []);
    }).finally(() => setLoading(false));
  }, []);

  async function loadRoutes(clientID: string) {
    const d = await api.get<{ routes: Route[] }>(`/v1/admin/routes?client_id=${clientID}`);
    setRoutes(d.routes || []);
  }

  async function createRoute() {
    await api.post("/v1/admin/routes", form);
    if (selectedClient) loadRoutes(selectedClient);
  }

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Client Routing</h1>
        <p className="text-gray-500 text-sm mt-1">Assign clients to processing merchants</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <h3 className="font-medium text-gray-900 mb-3">Create Route</h3>
        <div className="grid grid-cols-4 gap-3">
          <select value={form.client_id} onChange={e => setForm(f => ({...f, client_id: e.target.value}))}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">Select Client</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.business_name}</option>)}
          </select>
          <select value={form.processing_merchant_id} onChange={e => setForm(f => ({...f, processing_merchant_id: e.target.value}))}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">Select Merchant</option>
            {merchants.map(m => <option key={m.id} value={m.id}>{m.display_name}</option>)}
          </select>
          <input type="number" value={form.priority} onChange={e => setForm(f => ({...f, priority: parseInt(e.target.value)}))}
            placeholder="Priority (1=primary)"
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          <button onClick={createRoute}
            disabled={!form.client_id || !form.processing_merchant_id}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
            Assign
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
        <div className="flex items-center space-x-3">
          <label className="text-sm text-gray-500">View routes for:</label>
          <select value={selectedClient} onChange={e => { setSelectedClient(e.target.value); if (e.target.value) loadRoutes(e.target.value); }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">Select Client</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.business_name}</option>)}
          </select>
        </div>
      </div>

      {routes.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Merchant</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Provider</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Priority</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {routes.map(r => (
                <tr key={r.id}>
                  <td className="px-6 py-4 text-sm font-medium">{r.merchant_display_name}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">{r.provider}</td>
                  <td className="px-6 py-4 text-sm">{r.priority === 1 ? "Primary" : `Fallback (${r.priority})`}</td>
                  <td className="px-6 py-4"><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
