"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";

interface Client {
  id: string;
  client_code: string;
  business_name: string;
  legal_name: string;
  email: string;
  phone: string;
  website_url: string;
  upi_vpa?: string;
  paytm_mid?: string;
  status: string;
  kyc_status: string;
  risk_status: string;
  created_at: string;
}

interface Merchant {
  id: string;
  merchant_code: string;
  display_name: string;
  upi_vpa?: string;
  paytm_mid?: string;
}

interface Agent {
  id: string;
  agent_code: string;
  display_name: string;
  client_id?: string;
  processing_merchant_id?: string;
  status: string;
}

interface Route {
  id: string;
  processing_merchant_id: string;
  merchant_code: string;
  merchant_display_name: string;
}

export default function AdminClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [client, setClient] = useState<Client | null>(null);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMerchant, setSelectedMerchant] = useState("");
  const [agentForm, setAgentForm] = useState({
    agent_code: "",
    display_name: "",
    secret: "",
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function load() {
    const [c, m, a, r] = await Promise.all([
      api.get<Client>(`/v1/admin/clients/${id}`),
      api.get<{ processing_merchants: Merchant[] }>("/v1/admin/processing-merchants"),
      api.get<{ agents: Agent[] }>("/v1/admin/agents"),
      api.get<{ routes: (Route & { client_id: string })[] }>(`/v1/admin/routes?client_id=${id}`),
    ]);
    setClient(c);
    setMerchants(m.processing_merchants || []);
    setAgents((a.agents || []).filter((x) => x.client_id === id));
    setRoutes(r.routes || []);
    if (r.routes?.[0]) setSelectedMerchant(r.routes[0].processing_merchant_id);
  }

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [id]);

  async function assignRoute() {
    if (!selectedMerchant) return;
    setSaving(true);
    setMsg("");
    try {
      await api.post("/v1/admin/routes", {
        client_id: id,
        processing_merchant_id: selectedMerchant,
        priority: 1,
      });
      setMsg("Processing merchant assigned");
      load();
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "Failed to assign route");
    } finally {
      setSaving(false);
    }
  }

  async function createAgent() {
    setSaving(true);
    setMsg("");
    try {
      await api.post(`/v1/admin/clients/${id}/agents`, {
        ...agentForm,
        processing_merchant_id: selectedMerchant || routes[0]?.processing_merchant_id || "",
      });
      setAgentForm({ agent_code: "", display_name: "", secret: "" });
      setMsg("Verifier agent created — use these credentials in Chrome extension");
      load();
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "Failed to create agent");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;
  if (!client) return <div className="p-8 text-red-500">Client not found</div>;

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center space-x-4">
        <a href="/admin/clients" className="text-blue-600 hover:underline text-sm">← Clients</a>
        <h1 className="text-2xl font-bold text-gray-900">{client.business_name}</h1>
      </div>

      {msg && (
        <div className="mb-4 bg-green-50 border border-green-200 text-green-800 text-sm rounded-lg px-4 py-3">
          {msg}
        </div>
      )}

      <div className="grid grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Business Details</h3>
          <div className="space-y-3">
            {[
              ["Client Code", client.client_code],
              ["Business Name", client.business_name],
              ["Email", client.email],
              ["UPI VPA", client.upi_vpa || "-"],
              ["Paytm MID", client.paytm_mid || "-"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between text-sm">
                <span className="text-gray-500">{k}</span>
                <span className="text-gray-900 font-medium">{v}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Status</h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-500">Account</span>
              <StatusBadge status={client.status} />
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-500">KYC</span>
              <StatusBadge status={client.kyc_status} />
            </div>
          </div>
          <div className="mt-6 flex space-x-2">
            <button onClick={() => api.post(`/v1/admin/clients/${id}/approve`).then(load)}
              className="flex-1 bg-green-600 text-white py-2 rounded-lg text-sm hover:bg-green-700">Approve</button>
            <button onClick={() => api.post(`/v1/admin/clients/${id}/suspend`).then(load)}
              className="flex-1 border border-orange-300 text-orange-700 py-2 rounded-lg text-sm hover:bg-orange-50">Suspend</button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h3 className="font-semibold text-gray-900 mb-4">Paytm / Processing Merchant (isolation)</h3>
        <p className="text-sm text-gray-500 mb-4">
          Assign a dedicated processing merchant with its own UPI VPA. Checkout uses merchant VPA, not shared pool.
        </p>

        {routes.length > 0 && (
          <div className="mb-4 text-sm">
            <span className="text-gray-500">Active route: </span>
            <code className="text-gray-800">{routes[0].merchant_display_name} ({routes[0].merchant_code})</code>
          </div>
        )}

        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="text-xs text-gray-500 block mb-1">Processing merchant</label>
            <select
              value={selectedMerchant}
              onChange={(e) => setSelectedMerchant(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="">Select merchant...</option>
              {merchants.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name} — {m.upi_vpa || "no VPA"}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={assignRoute}
            disabled={saving || !selectedMerchant}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            Assign route
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Verifier Agent (Chrome extension)</h3>
        <p className="text-sm text-gray-500 mb-4">
          One agent per client — extension only sees this client&apos;s pending payments.
        </p>

        {agents.length > 0 && (
          <div className="mb-4 space-y-2">
            {agents.map((a) => (
              <div key={a.id} className="flex items-center justify-between text-sm bg-gray-50 rounded-lg px-4 py-3">
                <div>
                  <code className="font-medium">{a.agent_code}</code>
                  <span className="text-gray-500 ml-2">{a.display_name}</span>
                </div>
                <StatusBadge status={a.status} />
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          <input
            placeholder="Agent code (e.g. AGENT_RAVI)"
            value={agentForm.agent_code}
            onChange={(e) => setAgentForm((f) => ({ ...f, agent_code: e.target.value }))}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
          <input
            placeholder="Display name"
            value={agentForm.display_name}
            onChange={(e) => setAgentForm((f) => ({ ...f, display_name: e.target.value }))}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
          <input
            placeholder="Secret"
            value={agentForm.secret}
            onChange={(e) => setAgentForm((f) => ({ ...f, secret: e.target.value }))}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>
        <button
          onClick={createAgent}
          disabled={saving || !agentForm.agent_code || !agentForm.secret}
          className="mt-3 bg-purple-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-purple-700 disabled:opacity-50"
        >
          Create dedicated agent
        </button>
      </div>
    </div>
  );
}
