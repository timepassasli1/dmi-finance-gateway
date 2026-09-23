"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCurrency, formatDate } from "@/lib/utils";
import { payPageUrl } from "@/lib/gateway-config";

interface CreatedLink {
  gateway_payment_id: string;
  gateway_order_id: string;
  client_order_id: string;
  amount: number;
  currency: string;
  status: string;
  payment_url: string;
  created_at: string;
}

interface PaymentRow {
  gateway_payment_id: string;
  client_order_id: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
}

export default function PaymentLinksPage() {
  const [tab, setTab] = useState<"link" | "request">("link");
  const [amount, setAmount] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerUpi, setCustomerUpi] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<CreatedLink | null>(null);
  const [copied, setCopied] = useState(false);
  const [recent, setRecent] = useState<PaymentRow[]>([]);

  function loadRecent() {
    api
      .get<{ payments: PaymentRow[] }>("/v1/client/payments?limit=20")
      .then((d) => setRecent((d.payments || []).filter((p) => p.client_order_id?.startsWith("LINK_") || p.client_order_id?.startsWith("REQ_"))))
      .catch(() => {});
  }

  useEffect(() => {
    loadRecent();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setCreated(null);
    const rupees = Number(amount);
    if (!rupees || rupees <= 0) {
      setError("Valid amount enter karo");
      return;
    }
    if (tab === "request" && !customerUpi.includes("@")) {
      setError("Customer UPI ID required (e.g. name@paytm)");
      return;
    }
    setBusy(true);
    try {
      const payment = await api.post<CreatedLink>("/v1/client/payment-links", {
        amount: Math.round(rupees * 100),
        currency: "INR",
        customer_name: customerName || undefined,
        customer_phone: customerPhone || undefined,
        customer_upi: customerUpi || undefined,
        note: note || undefined,
        type: tab,
      });
      // Always share production/site origin — never localhost
      payment.payment_url = payPageUrl(payment.gateway_payment_id);
      setCreated(payment);
      loadRecent();
      setAmount("");
      setNote("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  function shareWhatsApp(url: string, amt: number) {
    const text = encodeURIComponent(
      `Please pay ₹${(amt / 100).toFixed(2)} using this secure link:\n${url}`
    );
    window.open(`https://wa.me/?text=${text}`, "_blank");
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Payment Links</h1>
        <p className="mt-1 text-sm text-gray-500">
          Create shareable pay links or payment requests — customer opens link and pays via UPI
        </p>
      </div>

      <div className="mb-4 flex gap-2">
        <button
          type="button"
          onClick={() => setTab("link")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${
            tab === "link" ? "bg-[#6726A8] text-white" : "bg-white text-gray-600 border border-gray-200"
          }`}
        >
          Payment Link
        </button>
        <button
          type="button"
          onClick={() => setTab("request")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${
            tab === "request" ? "bg-[#6726A8] text-white" : "bg-white text-gray-600 border border-gray-200"
          }`}
        >
          Payment Request
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <form onSubmit={submit} className="rounded-xl border border-gray-200 bg-white p-6 space-y-4">
          <h2 className="font-semibold text-gray-900">
            {tab === "link" ? "Create payment link" : "Create payment request"}
          </h2>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Amount (₹)</label>
            <input
              type="number"
              min="1"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="399"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Customer name (optional)</label>
            <input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Amit"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Phone (optional)</label>
            <input
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="98xxxxxxxx"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          {tab === "request" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Customer UPI ID</label>
              <input
                value={customerUpi}
                onChange={(e) => setCustomerUpi(e.target.value)}
                placeholder="customer@paytm"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                required
              />
              <p className="mt-1 text-[11px] text-gray-400">
                Share link se customer pay karega (collect intent production webhook/provider se attach hoga)
              </p>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Note (optional)</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Order #123"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-[#6726A8] py-2.5 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-50"
          >
            {busy ? "Creating…" : tab === "link" ? "Create & get link" : "Create request link"}
          </button>
        </form>

        <div className="space-y-4">
          {created && (
            <div className="rounded-xl border border-green-200 bg-green-50 p-5">
              <h3 className="font-semibold text-green-900">Ready — share this link</h3>
              <p className="mt-1 text-sm text-green-800">
                {formatCurrency(created.amount, created.currency)} · {created.gateway_payment_id}
              </p>
              <div className="mt-3 break-all rounded-lg border border-green-200 bg-white px-3 py-2 text-xs text-gray-800">
                {created.payment_url}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => copyLink(created.payment_url)}
                  className="rounded-lg bg-[#6726A8] px-4 py-2 text-sm font-semibold text-white"
                >
                  {copied ? "Copied!" : "Copy link"}
                </button>
                <button
                  type="button"
                  onClick={() => shareWhatsApp(created.payment_url, created.amount)}
                  className="rounded-lg border border-green-300 bg-white px-4 py-2 text-sm font-semibold text-green-800"
                >
                  WhatsApp
                </button>
                <a
                  href={created.payment_url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700"
                >
                  Open pay page
                </a>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-5 py-3 text-sm font-semibold text-gray-900">
              Recent links / requests
            </div>
            <div className="divide-y divide-gray-50">
              {recent.length === 0 && (
                <div className="px-5 py-8 text-center text-sm text-gray-400">No links yet</div>
              )}
              {recent.map((p) => {
                const url = payPageUrl(p.gateway_payment_id);
                return (
                  <div key={p.gateway_payment_id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900">{formatCurrency(p.amount, p.currency)}</div>
                      <div className="truncate text-xs text-gray-400">{p.gateway_payment_id}</div>
                      <div className="text-[11px] text-gray-400">{formatDate(p.created_at)}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusBadge status={p.status} />
                      <button
                        type="button"
                        onClick={() => copyLink(url)}
                        className="rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-[#6726A8]"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
