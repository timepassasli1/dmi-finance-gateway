"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, APIError } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate } from "@/lib/utils";
import { CodeBlock } from "@/components/CodeBlock";

interface Webhook {
  id: string;
  url: string;
  is_active: boolean;
  signing_secret?: string;
}

export default function WebhooksPage() {
  const [data, setData] = useState<{ webhooks: Webhook[]; recent_deliveries: unknown[] }>({ webhooks: [], recent_deliveries: [] });
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Webhook | null>(null);
  const [editUrl, setEditUrl] = useState("");
  const [newSecret, setNewSecret] = useState<{ url: string; secret: string } | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function load() {
    try {
      const d = await api.get<{ webhooks: Webhook[]; recent_deliveries: unknown[] }>("/v1/client/webhooks");
      setData(d);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load webhooks");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function register() {
    if (!url.trim()) return;
    setError("");
    try {
      const wh = await api.post<Webhook>("/v1/client/webhooks", {
        url: url.trim(),
        events: ["payment.success", "payment.failed", "payment.pending"],
      });
      if (wh.signing_secret) {
        setNewSecret({ url: wh.url, secret: wh.signing_secret });
      }
      setUrl("");
      load();
    } catch (e) {
      setError(e instanceof APIError ? e.message : "Failed to register webhook");
    }
  }

  async function saveEdit() {
    if (!editing) return;
    setError("");
    try {
      await api.patch(`/v1/client/webhooks/${editing.id}`, { url: editUrl, is_active: editing.is_active });
      setEditing(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update webhook");
    }
  }

  async function toggleActive(w: Webhook) {
    await api.patch(`/v1/client/webhooks/${w.id}`, { url: w.url, is_active: !w.is_active });
    load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this webhook?")) return;
    await api.delete(`/v1/client/webhooks/${id}`);
    load();
  }

  async function sendTest() {
    try {
      await api.post("/v1/client/webhooks/test");
      alert("Test webhook queued — check your server logs");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test failed");
    }
  }

  const sigExample = `// Verify incoming webhook (use signing_secret from registration)
const rawBody = await request.text();
const sig = request.headers.get("X-Gateway-Signature"); // v1=<hmac>
const ts = request.headers.get("X-Gateway-Timestamp");
const payload = ts + "." + rawBody;
const expected = crypto.createHmac("sha256", signingSecret)
  .update(payload).digest("hex");
const ok = sig === "v1=" + expected;`;

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Webhooks</h1>
        <p className="text-gray-500 text-sm mt-1">
          Your server receives POST requests when payments succeed or fail
        </p>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg px-4 py-3">{error}</div>
      )}

      {newSecret && (
        <div className="mb-6 bg-green-50 border border-green-200 rounded-xl p-5">
          <h3 className="font-semibold text-green-900 mb-1">Webhook registered</h3>
          <p className="text-xs text-green-700 mb-3">
            Save this signing secret — shown only once. Use it to verify{" "}
            <code className="bg-green-100 px-1 rounded">X-Gateway-Signature</code> headers.
          </p>
          <div className="text-xs text-green-800 mb-1">Endpoint: {newSecret.url}</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white border border-green-200 rounded px-3 py-2 text-xs font-mono break-all">
              {newSecret.secret}
            </code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(newSecret.secret);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="text-xs text-green-700 shrink-0"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <button type="button" onClick={() => setNewSecret(null)} className="mt-3 text-xs text-green-700 underline">
            Dismiss
          </button>
        </div>
      )}

      <div className="mb-6 bg-white rounded-xl border border-gray-200 p-5 text-sm text-gray-600">
        <p>
          Need API keys first?{" "}
          <Link href="/dashboard/api-keys" className="text-blue-600 underline">API Keys</Link>
          {" · "}
          <Link href="/dashboard/integration" className="text-blue-600 underline">Integration guide</Link>
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <h3 className="font-medium text-gray-900 mb-3">Add Webhook Endpoint</h3>
        <div className="flex flex-wrap gap-3">
          <input value={url} onChange={e => setUrl(e.target.value)}
            placeholder="https://your-site.com/webhooks/gateway"
            className="flex-1 min-w-[200px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <button onClick={register} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700">Register</button>
          <button onClick={sendTest} className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-50">Send Test</button>
        </div>
        <p className="text-xs text-gray-400 mt-2">Events: payment.success, payment.failed, payment.pending</p>
      </div>

      {editing && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <h4 className="text-sm font-medium text-amber-900 mb-2">Edit webhook</h4>
          <div className="flex gap-2">
            <input value={editUrl} onChange={(e) => setEditUrl(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            <button onClick={saveEdit} className="bg-blue-600 text-white px-3 py-2 rounded-lg text-sm">Save</button>
            <button onClick={() => setEditing(null)} className="border px-3 py-2 rounded-lg text-sm">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 mb-6">
        <div className="px-6 py-4 border-b border-gray-100"><h3 className="font-semibold text-gray-900">Endpoints ({(data.webhooks || []).length})</h3></div>
        <div className="divide-y divide-gray-50">
          {(data.webhooks || []).length === 0 && <div className="px-6 py-8 text-center text-gray-400 text-sm">No webhooks configured</div>}
          {(data.webhooks || []).map(w => (
            <div key={w.id} className="px-6 py-4 flex items-center justify-between gap-4">
              <code className="text-sm text-gray-700 truncate">{w.url}</code>
              <div className="flex items-center gap-3 shrink-0">
                <StatusBadge status={w.is_active ? "ACTIVE" : "INACTIVE"} />
                <button onClick={() => toggleActive(w)} className="text-xs text-gray-600 hover:underline">
                  {w.is_active ? "Disable" : "Enable"}
                </button>
                <button onClick={() => { setEditing(w); setEditUrl(w.url); }} className="text-xs text-blue-600 hover:underline">Edit</button>
                <button onClick={() => remove(w.id)} className="text-xs text-red-600 hover:underline">Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 mb-6 p-6">
        <CodeBlock title="Verify webhook signature (Node.js)" code={sigExample} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100"><h3 className="font-semibold text-gray-900">Recent Deliveries</h3></div>
        <div className="divide-y divide-gray-50">
          {(data.recent_deliveries || []).length === 0 && <div className="px-6 py-8 text-center text-gray-400 text-sm">No deliveries yet</div>}
          {(data.recent_deliveries as Array<{ id: string; event_type: string; status: string; attempt_count: number; last_response_code: number; created_at: string }>).map(d => (
            <div key={d.id} className="px-6 py-4 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-900">{d.event_type}</div>
                <div className="text-xs text-gray-400">Attempts: {d.attempt_count} · HTTP {d.last_response_code || "-"} · {formatDate(d.created_at)}</div>
              </div>
              <StatusBadge status={d.status} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
