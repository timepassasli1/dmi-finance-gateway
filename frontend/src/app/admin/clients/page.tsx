"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate } from "@/lib/utils";

interface Client {
  id: string;
  client_code: string;
  business_name: string;
  email: string;
  status: string;
  kyc_status: string;
  risk_status: string;
  created_at: string;
}

export default function AdminClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  async function load() {
    const q = filter ? `?status=${filter}` : "";
    try {
      const d = await api.get<{ clients: Client[] }>(`/v1/admin/clients${q}`);
      setClients(d.clients || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [filter]);

  async function approve(id: string) {
    await api.post(`/v1/admin/clients/${id}/approve`);
    load();
  }
  async function reject(id: string) {
    const reason = prompt("Rejection reason:");
    await api.post(`/v1/admin/clients/${id}/reject`, { reason });
    load();
  }
  async function suspend(id: string) {
    await api.post(`/v1/admin/clients/${id}/suspend`);
    load();
  }
  async function generateKeys(id: string) {
    const data = await api.post<{ key: { client_key: string; public_key: string; secret_key: string; webhook_secret: string } }>(
      `/v1/admin/clients/${id}/api-keys`
    );
    alert(`Keys generated!\n\nClient Key: ${data.key.client_key}\nPublic: ${data.key.public_key}\nSecret: ${data.key.secret_key}\nWebhook: ${data.key.webhook_secret}\n\nSave these — secret shown only once.`);
  }

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clients</h1>
          <p className="text-gray-500 text-sm mt-1">{clients.length} clients</p>
        </div>
        <select value={filter} onChange={e => setFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All Status</option>
          <option value="PENDING">Pending</option>
          <option value="UNDER_REVIEW">Under Review</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="REJECTED">Rejected</option>
        </select>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Business</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Code</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">KYC</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Registered</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {clients.length === 0 && (
                <tr><td colSpan={6} className="text-center py-12 text-gray-400">No clients</td></tr>
              )}
              {clients.map(c => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="font-medium text-sm text-gray-900">{c.business_name}</div>
                    <div className="text-xs text-gray-400">{c.email}</div>
                  </td>
                  <td className="px-6 py-4"><code className="text-xs text-gray-600">{c.client_code}</code></td>
                  <td className="px-6 py-4"><StatusBadge status={c.status} /></td>
                  <td className="px-6 py-4"><StatusBadge status={c.kyc_status} /></td>
                  <td className="px-6 py-4 text-xs text-gray-400">{formatDate(c.created_at)}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center space-x-2">
                      <a href={`/admin/clients/${c.id}`} className="text-xs text-blue-600 hover:underline">View</a>
                      {c.status !== "ACTIVE" && (
                        <button onClick={() => approve(c.id)} className="text-xs text-green-600 hover:underline">Approve</button>
                      )}
                      {c.status === "ACTIVE" && (
                        <button onClick={() => suspend(c.id)} className="text-xs text-orange-600 hover:underline">Suspend</button>
                      )}
                      {c.status !== "REJECTED" && (
                        <button onClick={() => reject(c.id)} className="text-xs text-red-600 hover:underline">Reject</button>
                      )}
                      <button onClick={() => generateKeys(c.id)} className="text-xs text-purple-600 hover:underline">Gen Keys</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
