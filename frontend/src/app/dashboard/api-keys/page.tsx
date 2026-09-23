"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, APIError } from "@/lib/api";
import { formatDate } from "@/lib/utils";

interface APIKey {
  id: string;
  key_name: string;
  client_key: string;
  public_key: string;
  secret_key_prefix: string;
  status: string;
  last_used_at?: string;
  created_at: string;
}

interface NewKey {
  key: {
    id: string;
    client_key: string;
    public_key: string;
    secret_key: string;
    webhook_secret: string;
    key_name: string;
  };
  warning?: string;
}

interface Profile {
  status: string;
}

export default function APIKeysPage() {
  const [keys, setKeys] = useState<APIKey[]>([]);
  const [newKey, setNewKey] = useState<NewKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [name, setName] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);

  async function load() {
    try {
      const [data, prof] = await Promise.all([
        api.get<{ api_keys: APIKey[] }>("/v1/client/api-keys"),
        api.get<Profile>("/v1/client/profile"),
      ]);
      setKeys(data.api_keys || []);
      setProfile(prof);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load API keys");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function generate() {
    setGenerating(true);
    setError("");
    try {
      const k = await api.post<NewKey>("/v1/client/api-keys", { key_name: name || "Default" });
      setNewKey(k);
      setName("");
      load();
    } catch (e) {
      setError(e instanceof APIError ? e.message : "Failed to generate key");
    } finally {
      setGenerating(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this API key? This cannot be undone.")) return;
    setError("");
    try {
      await api.post(`/v1/client/api-keys/${id}/revoke`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to revoke key");
    }
  }

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }

  const inactive = profile && profile.status !== "ACTIVE";

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">API Keys</h1>
        <p className="text-gray-500 text-sm mt-1">
          Server credentials for creating orders and verifying payments on your website
        </p>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {inactive && (
        <div className="mb-4 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3">
          Account not active yet — complete{" "}
          <Link href="/dashboard/setup" className="underline font-medium">Get Started</Link>
          {" "}and wait for admin approval before generating keys.
        </div>
      )}

      <div className="mb-6 bg-white rounded-xl border border-gray-200 p-5 text-sm text-gray-600">
        <p className="font-medium text-gray-900 mb-2">How to use these keys</p>
        <ul className="space-y-1 list-disc list-inside">
          <li><code className="text-xs bg-gray-100 px-1 rounded">sk_live_</code> — your server backend only (create orders, verify payments)</li>
          <li><code className="text-xs bg-gray-100 px-1 rounded">pk_live_</code> — safe to reference in frontend (identifies your account)</li>
          <li><code className="text-xs bg-gray-100 px-1 rounded">whsec_</code> — legacy; use webhook endpoint secret from{" "}
            <Link href="/dashboard/webhooks" className="text-blue-600 underline">Webhooks</Link> for signature verification
          </li>
        </ul>
        <Link href="/dashboard/integration" className="inline-block mt-3 text-blue-600 hover:underline font-medium">
          View full integration guide →
        </Link>
      </div>

      {newKey && (
        <div className="mb-6 bg-green-50 border border-green-200 rounded-xl p-5">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className="font-semibold text-green-900">API Keys Generated</h3>
              <p className="text-xs text-green-700 mt-0.5">
                {newKey.warning || "Save these now — secret key is shown only once."}
              </p>
            </div>
            <button onClick={() => setNewKey(null)} className="text-green-600 hover:text-green-800">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          {[
            ["Client ID", newKey.key.client_key],
            ["Public Key (pk_live_)", newKey.key.public_key],
            ["Secret Key (sk_live_) — server only", newKey.key.secret_key],
            ["Webhook Secret (whsec_)", newKey.key.webhook_secret],
          ].map(([label, val]) => (
            <div key={label} className="mt-2">
              <div className="text-xs font-medium text-green-800 mb-1">{label}</div>
              <div className="flex items-center space-x-2">
                <code className="flex-1 bg-white border border-green-200 rounded px-3 py-1.5 text-xs font-mono text-gray-800 break-all">
                  {val}
                </code>
                <button
                  onClick={() => copy(val, label)}
                  className="text-xs text-green-700 hover:text-green-900 shrink-0"
                >
                  {copied === label ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 mb-6 p-5">
        <h3 className="font-medium text-gray-900 mb-3">Generate New API Key</h3>
        <div className="flex space-x-3">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Key name (e.g. Production, Website)"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={generate}
            disabled={generating || !!inactive}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {generating ? "Generating..." : "Generate"}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Active Keys</h3>
        </div>
        <div className="divide-y divide-gray-50">
          {keys.length === 0 && (
            <div className="px-6 py-8 text-center text-gray-400 text-sm">No active API keys — generate one to integrate your site</div>
          )}
          {keys.map(k => (
            <div key={k.id} className="px-6 py-4">
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm text-gray-900">{k.key_name}</div>
                  <div className="text-xs text-gray-500 mt-0.5">Client ID: {k.client_key}</div>
                  <div className="mt-2 space-y-1">
                    <div className="text-xs text-gray-400 break-all">Public: <code className="text-gray-600">{k.public_key}</code></div>
                    <div className="text-xs text-gray-400">Secret: <code className="text-gray-600">{k.secret_key_prefix}••••••••</code> (not retrievable)</div>
                  </div>
                  {k.last_used_at && (
                    <div className="text-xs text-gray-400 mt-1">Last used: {formatDate(k.last_used_at)}</div>
                  )}
                </div>
                <button
                  onClick={() => revoke(k.id)}
                  className="text-xs text-red-600 hover:text-red-800 border border-red-200 px-2 py-1 rounded shrink-0 ml-3"
                >
                  Revoke
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
