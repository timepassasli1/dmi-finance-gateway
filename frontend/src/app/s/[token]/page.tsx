"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import { gatewaySiteUrl, payPageUrl } from "@/lib/gateway-config";
import { DMI_BRAND, loanPayCopy } from "@/lib/dmi-theme";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "/gw";

interface ShareInfo {
  business_name: string;
  brand_color?: string;
  logo_url?: string;
  has_upi?: boolean;
}

interface Created {
  gateway_payment_id: string;
  amount: number;
  currency: string;
  payment_url: string;
  track_code?: string;
}

export default function SharedCreatePage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);

  const brand = info?.brand_color || DMI_BRAND.teal;
  const copy = loanPayCopy(info?.business_name || "DMI Finance");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/v1/share/${token}`);
      if (!res.ok) throw new Error("Invalid share link");
      setInfo(await res.json());
    } catch (e: unknown) {
      setLoadErr(e instanceof Error ? e.message : "Failed to load");
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setCreated(null);
    const rupees = Number(amount);
    if (!rupees || rupees <= 0) {
      setError("Outstanding amount enter karo");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/v1/share/${token}/payment-links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Math.round(rupees * 100),
          currency: "INR",
          customer_name: note || undefined,
          note: note ? `Loan dues — ${note}` : "Loan outstanding repayment",
          type: "link",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || "Create failed");
      }
      const url = payPageUrl(data.gateway_payment_id) || data.payment_url;
      setCreated({
        gateway_payment_id: data.gateway_payment_id,
        amount: data.amount,
        currency: data.currency || "INR",
        payment_url: url.startsWith("http") ? url : `${gatewaySiteUrl()}/pay/${data.gateway_payment_id}`,
        track_code: data.track_code,
      });
      setAmount("");
      setNote("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed");
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

  if (loadErr) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6" style={{ background: DMI_BRAND.paper }}>
        <div className="rounded-2xl border border-red-100 bg-white px-6 py-8 text-center shadow-sm">
          <p className="text-sm font-medium text-red-600">{loadErr}</p>
        </div>
      </main>
    );
  }

  if (!info) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6" style={{ background: DMI_BRAND.paper }}>
        <p className="text-sm text-slate-500">Loading…</p>
      </main>
    );
  }

  const amtLabel = created ? formatCurrency(created.amount, created.currency) : "";
  const wa = created
    ? encodeURIComponent(copy.waText(amtLabel, created.payment_url, note || undefined))
    : "";

  return (
    <main
      className="min-h-screen px-4 py-10"
      style={{
        background: `radial-gradient(800px 320px at 50% -40px, ${brand}40, transparent 50%), linear-gradient(180deg, #E8F1F3 0%, ${DMI_BRAND.paper} 50%)`,
        fontFamily: '"DM Sans", system-ui, sans-serif',
      }}
    >
      <div className="mx-auto w-full max-w-md">
        <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-lg shadow-slate-200/60">
          <div
            className="relative px-5 py-5 text-white"
            style={{
              background: `linear-gradient(145deg, ${DMI_BRAND.navy} 0%, ${brand} 60%, ${DMI_BRAND.mint} 130%)`,
            }}
          >
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/dmi-mark.svg" alt="" className="h-12 w-12 rounded-xl shadow" />
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#C4A35A]">
                  Official collection desk
                </p>
                <h1
                  className="text-[22px] font-semibold tracking-tight"
                  style={{ fontFamily: '"Fraunces", Georgia, serif' }}
                >
                  {info.business_name}
                </h1>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {["SSL Secured", "Encrypted link", "UPI protected"].map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-black/25 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-[#B8F5C8]"
                >
                  {t}
                </span>
              ))}
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-white/90">
              Callers: outstanding loan / EMI amount enter karke customer ko formal repayment link bhejo.
              Customer sirf amount pay karega — OTP / PIN kabhi mat maango.
            </p>
          </div>

          <form onSubmit={submit} className="space-y-4 p-5">
            {!info.has_upi && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                UPI ID set nahi hai. Settings me receive VPA daalo.
              </div>
            )}
            <div>
              <label className="mb-1 block text-[13px] font-semibold text-slate-800">
                Outstanding amount (₹)
              </label>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 2500"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-3 text-[16px] outline-none focus:ring-2"
                style={{ ["--tw-ring-color" as string]: `${brand}44` }}
                autoFocus
              />
              <p className="mt-1 text-[11px] text-slate-400">Exact overdue / EMI amount jo customer ko clear karna hai</p>
            </div>
            <div>
              <label className="mb-1 block text-[13px] font-semibold text-slate-800">
                Customer / loan reference
              </label>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Name · Loan ID · Mobile"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:ring-2"
                style={{ ["--tw-ring-color" as string]: `${brand}44` }}
              />
            </div>
            {error && <p className="text-[13px] font-medium text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl py-3.5 text-[15px] font-semibold text-white disabled:opacity-50"
              style={{ background: `linear-gradient(90deg, ${DMI_BRAND.navy}, ${brand})` }}
            >
              {busy ? "Generating secure link…" : "Generate secure repayment link"}
            </button>
            <p className="text-center text-[11px] leading-relaxed text-slate-400">
              Link bank-grade UPI checkout open karega. Customer ko WhatsApp / SMS se bhejo.
            </p>
          </form>

          {created && (
            <div className="border-t border-slate-100 bg-[#F7FAFB] p-5">
              <p className="text-[13px] font-semibold text-slate-800">
                Secure customer repayment link · {amtLabel}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                Official DMI Finance collection URL — customer ko yahi bhejo
              </p>
              {created.track_code && (
                <p className="mt-1 font-mono text-[11px] text-slate-500">Track · {created.track_code}</p>
              )}
              <div className="mt-3 break-all rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[13px] text-slate-800">
                {created.payment_url}
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => copyLink(created.payment_url)}
                  className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-800"
                >
                  {copied ? "Copied" : "Copy secure link"}
                </button>
                <a
                  href={`https://wa.me/?text=${wa}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 rounded-xl py-2.5 text-center text-sm font-semibold text-white"
                  style={{ background: "#25D366" }}
                >
                  WhatsApp
                </a>
              </div>
              <a
                href={created.payment_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 block text-center text-[12px] font-medium"
                style={{ color: brand }}
              >
                Preview pay page →
              </a>
            </div>
          )}
        </div>
        <div className="mt-4 space-y-1 text-center text-[11px] leading-relaxed text-slate-500">
          <p className="font-medium text-slate-600">DMI Finance · Secure UPI repayment desk</p>
          <p>Encrypted session · No login needed for callers · Never request OTP / UPI PIN</p>
        </div>
      </div>
    </main>
  );
}
