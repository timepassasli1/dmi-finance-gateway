"use client";
import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import { DMI_BRAND, isLoanFinanceBrand, loanPayCopy } from "@/lib/dmi-theme";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "/gw";

interface PaymentData {
  gateway_payment_id: string;
  gateway_order_id: string;
  client_order_id?: string;
  amount: number;
  currency: string;
  status: string;
  upi_intent_url: string;
  qr_data: string;
  merchant_name?: string;
  merchant_logo_url?: string;
  brand_color?: string;
  merchant_upi_vpa?: string;
  intent_code?: string;
  track_code?: string;
  intent_code_expires_at?: string;
  expires_at?: string;
  created_at: string;
}

const UPI_APPS: {
  id: string;
  name: string;
  bg: string;
  logo: string;
  letter: string;
  border?: boolean;
}[] = [
  { id: "phonepe", name: "PhonePe", bg: "#FFFFFF", logo: "/upi-logo/phonepe.png", letter: "Pe" },
  { id: "paytm", name: "Paytm", bg: "#FFFFFF", border: true, logo: "/upi-logo/paytm.png", letter: "Pay" },
];

export default function PaymentPage() {
  const { id } = useParams<{ id: string }>();
  const [payment, setPayment] = useState<PaymentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [polling, setPolling] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [tab, setTab] = useState<"upi" | "qr">("upi");
  const [upiId, setUpiId] = useState("");
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  const [copiedVpa, setCopiedVpa] = useState(false);
  const [openedApp, setOpenedApp] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [desktopHint, setDesktopHint] = useState("");
  const [selectedApp, setSelectedApp] = useState<string>("phonepe");

  const brand = payment?.brand_color || (isLoanFinanceBrand(payment?.merchant_name) ? DMI_BRAND.teal : "#6726A8");
  const copy = loanPayCopy(payment?.merchant_name);
  const loanTheme = isLoanFinanceBrand(payment?.merchant_name);

  useEffect(() => {
    const mobile = /iPhone|Android|iPad/i.test(navigator.userAgent);
    setIsMobile(mobile);
    setTab(mobile ? "upi" : "qr");
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/v1/pay/${id}`);
      if (!res.ok) throw new Error("Payment not found");
      const data = await res.json();
      setPayment(data);
      setStatus(data.status);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load payment");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      // Start 5-min timer on open, then load payment with expires_at
      await fetch(`${API_URL}/v1/pay/${id}/watch`, { method: "POST" }).catch(() => {});
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [id, load]);

  useEffect(() => {
    if (status === "SUCCESS" || status === "FAILED" || status === "EXPIRED") return;
    setPolling(true);
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/v1/pay/${id}`);
        if (!res.ok) return;
        const data = await res.json();
        setStatus(data.status);
        setPayment((prev) => (prev ? { ...prev, ...data } : data));
        if (data.status === "SUCCESS" || data.status === "FAILED" || data.status === "EXPIRED") {
          clearInterval(interval);
          setPolling(false);
        }
      } catch {
        // Backend briefly down / network blip — keep polling silently
      }
    }, 1500);
    return () => {
      clearInterval(interval);
      setPolling(false);
    };
  }, [id, status]);

  const logoSrc = useMemo(() => {
    if (!payment?.merchant_logo_url) return "";
    if (payment.merchant_logo_url.startsWith("http")) return payment.merchant_logo_url;
    return `${API_URL}${payment.merchant_logo_url}`;
  }, [payment?.merchant_logo_url]);

  const secondsLeft = useMemo(() => {
    if (!payment?.expires_at) return null;
    return Math.max(0, Math.floor((new Date(payment.expires_at).getTime() - now) / 1000));
  }, [payment?.expires_at, now]);

  // Timer hits 0 → force refresh so backend can mark FAILED
  useEffect(() => {
    if (secondsLeft === null || secondsLeft > 0) return;
    if (status === "SUCCESS" || status === "FAILED" || status === "EXPIRED") return;
    load();
  }, [secondsLeft, status, load]);

  const timerLabel = useMemo(() => {
    if (secondsLeft === null) return null;
    const m = Math.floor(secondsLeft / 60);
    const s = secondsLeft % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, [secondsLeft]);

  const amountLabel = payment ? formatCurrency(payment.amount, payment.currency) : "";
  const upiVpa = payment?.merchant_upi_vpa || "merchant@upi";

  function isAndroidUA() {
    return typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);
  }

  function b64utf8(str: string) {
    return btoa(unescape(encodeURIComponent(str)));
  }

  function trackOf(p: PaymentData) {
    const raw = p.track_code || p.gateway_payment_id || "";
    if (!raw) return "";
    return raw.toUpperCase().startsWith("GW") ? raw.toUpperCase() : `GW${raw.toUpperCase()}`;
  }

  function buildAppDeepLink(appId: string, p: PaymentData) {
    const vpa = (p.merchant_upi_vpa || upiVpa || "").trim();
    const payeeName = p.merchant_name || "Merchant";
    const amountRupee = (p.amount || 0) / 100;
    const am = amountRupee.toFixed(2);
    const track = trackOf(p);
    const pn = encodeURIComponent(payeeName);
    const q = `pa=${vpa}&pn=${pn}&am=${am}&cu=INR&tn=${track}`;
    const upiPay = `upi://pay?${q}`;

    // DailyNut / Paimart exact PhonePe handlers
    if (appId === "phonepe") {
      if (isAndroidUA()) {
        // DEFAULT P2P native — this is the one that already confirmed GWBF7A44D4 on Paytm.
        // COLLECT (DailyNut phonepe2) opens PhonePe but often omits GW from UPI remarks.
        const payload = {
          contact: { cbsName: payeeName, nickName: payeeName, vpa, type: "VPA" },
          p2pPaymentCheckoutParams: {
            note: track || `OrderNo: ${p.gateway_payment_id}`,
            isByDefaultKnownContact: true,
            enableSpeechToText: false,
            allowAmountEdit: false,
            showQrCodeOption: false,
            disableViewHistory: true,
            shouldShowUnsavedContactBanner: false,
            isRecurring: false,
            checkoutType: "DEFAULT",
            transactionContext: "p2p",
            initialAmount: Math.round(amountRupee * 100),
            disableNotesEdit: true,
            showKeyboard: true,
            currency: "INR",
            shouldShowMaskedNumber: true,
          },
        };
        return `phonepe://native?data=${encodeURIComponent(b64utf8(JSON.stringify(payload)))}&id=p2ppayment`;
      }
      return `phonepe://upi//pay?pa=${vpa}&pn=${pn}&am=${am}&cu=INR&tn=${track}`;
    }

    if (appId === "paytm") {
      return (
        `paytmmp://cash_wallet?pa=${vpa}` +
        `&pn=${pn}&am=${am}&cu=INR&tn=${encodeURIComponent(track)}&featuretype=money_transfer`
      );
    }

    return upiPay;
  }

  function intentURL(appId: string, paymentData?: PaymentData) {
    const p = paymentData || payment;
    if (!p) return "";
    return buildAppDeepLink(appId, p);
  }

  /** Ask server for a brand-new short-lived intent code (anti-replay). */
  async function refreshIntent(): Promise<PaymentData | null> {
    try {
      const res = await fetch(`${API_URL}/v1/pay/${id}/fresh-intent`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || "Could not refresh payment code");
      }
      const data = await res.json();
      setPayment((prev) => (prev ? { ...prev, ...data } : data));
      setStatus(data.status);
      return data as PaymentData;
    } catch (e: unknown) {
      setDesktopHint(e instanceof Error ? e.message : "Fresh code failed");
      return null;
    }
  }

  function markOpened(appId: string, appName?: string) {
    setSelectedApp(appId);
    setOpenedApp(appName || appId);
    setPolling(true);
    if (!isMobile) {
      setDesktopHint(`${appName || "UPI app"} phone pe khulti hai — yahan Scan QR use karo.`);
      setTimeout(() => setTab("qr"), 800);
    }
  }

  const selectedAppMeta = UPI_APPS.find((a) => a.id === selectedApp) || UPI_APPS[0];

  async function openQRWithFreshCode() {
    setTab("qr");
    setDesktopHint("Naya secure QR generate ho raha hai…");
    const fresh = await refreshIntent();
    if (fresh?.upi_intent_url) {
      setDesktopHint("Yeh QR session ke liye valid hai — Paytm pe GW match hone tak wait");
      setTimeout(() => setDesktopHint(""), 4000);
    }
  }

  async function copyVpa() {
    try {
      await navigator.clipboard.writeText(upiVpa);
      setCopiedVpa(true);
      setTimeout(() => setCopiedVpa(false), 1500);
    } catch {
      /* ignore */
    }
  }

  function copyPayId() {
    if (!payment) return;
    navigator.clipboard?.writeText(payment.gateway_payment_id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function iHavePaid() {
    setConfirming(true);
    setPolling(true);
    setDesktopHint(
      "Payment check ho rahi hai… merchant extension Paytm pe SUCCESS mark karegi. Track note: " +
        (payment?.track_code || "—")
    );
    // Keep polling — confirmation comes from extension / agent, not this button alone
    setTimeout(() => setConfirming(false), 4000);
  }

  if (loading) {
    return (
      <Shell color={brand}>
        <div className="cf-card p-10 text-center text-sm text-slate-400">Loading secure checkout…</div>
      </Shell>
    );
  }

  if (error || !payment) {
    return (
      <Shell color="#6726A8">
        <div className="cf-card p-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-2xl text-red-500">!</div>
          <h2 className="text-lg font-semibold text-slate-900">Payment link invalid</h2>
          <p className="mt-2 text-sm text-slate-500">{error || "This payment link is invalid or expired."}</p>
        </div>
      </Shell>
    );
  }

  if (status === "SUCCESS") {
    return (
      <Shell color="#0B7A4B">
        <div className="cf-card overflow-hidden">
          <div className="bg-[#0B7A4B] px-6 py-8 text-center text-white">
            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-white/15 text-3xl">✓</div>
            <h2 className="text-xl font-semibold">Payment Successful</h2>
            <p className="mt-1 text-sm text-white/80">{amountLabel} paid to {payment.merchant_name}</p>
          </div>
          <div className="space-y-3 p-6 text-sm text-slate-600">
            <Row label="Status" value="SUCCESS" />
            <Row label="Merchant" value={payment.merchant_name || "Merchant"} />
            <Row label="Amount" value={amountLabel} />
            <Row label="UPI track note" value={payment.track_code || "—"} mono />
            <Row label="Payment ID" value={payment.gateway_payment_id} mono />
            <Row label="Order ID" value={payment.client_order_id || payment.gateway_order_id} mono />
          </div>
        </div>
      </Shell>
    );
  }

  if (status === "FAILED" || status === "EXPIRED") {
    const failed = status === "FAILED";
    return (
      <Shell color={failed ? "#991B1B" : "#92400E"}>
        <div className="cf-card overflow-hidden">
          <div
            className="px-6 py-8 text-center text-white"
            style={{ background: failed ? "#991B1B" : "#B45309" }}
          >
            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-white/15 text-3xl">
              {failed ? "✕" : "!"}
            </div>
            <h2 className="text-xl font-semibold">
              {failed ? "Payment Failed" : "Payment Expired"}
            </h2>
            <p className="mt-1 text-sm text-white/80">
              {failed
                ? `${amountLabel} — time khatam / incomplete`
                : `${amountLabel} — link expire ho gaya`}
            </p>
            <p className="mt-2 text-xs text-white/70">
              Agar UPI se paisa cut ho chuka hai to wait karo — extension verify karke SUCCESS kar sakti hai.
            </p>
          </div>
          <div className="space-y-3 p-6 text-sm text-slate-600">
            <Row label="Status" value={status} />
            <Row label="Merchant" value={payment.merchant_name || "Merchant"} />
            <Row label="Amount" value={amountLabel} />
            <Row label="UPI track note" value={payment.track_code || "—"} mono />
            <Row label="Payment ID" value={payment.gateway_payment_id} mono />
            <Row label="Order ID" value={payment.client_order_id || payment.gateway_order_id} mono />
          </div>
          <div className="border-t border-slate-100 px-6 py-4 text-center text-xs text-slate-500">
            Merchant se naya payment link leke dobara try karo.
          </div>
        </div>
      </Shell>
    );
  }

  if (status === "PENDING_REVIEW") {
    return (
      <Shell color="#C2410C">
        <div className="cf-card overflow-hidden">
          <div className="bg-[#C2410C] px-6 py-8 text-center text-white">
            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-white/15 text-3xl">
              …
            </div>
            <h2 className="text-xl font-semibold">Under Review</h2>
            <p className="mt-1 text-sm text-white/80">Payment verify ho rahi hai — wait karo</p>
          </div>
          <div className="space-y-3 p-6 text-sm text-slate-600">
            <Row label="Status" value="PENDING_REVIEW" />
            <Row label="Amount" value={amountLabel} />
            <Row label="UPI track note" value={payment.track_code || "—"} mono />
            <Row label="Payment ID" value={payment.gateway_payment_id} mono />
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell color={brand} loan={loanTheme}>
      <div className="cf-card overflow-hidden">
        {/* Brand header */}
        <div
          className="relative px-5 pb-5 pt-4 text-white"
          style={{
            background: loanTheme
              ? `linear-gradient(145deg, ${DMI_BRAND.navy} 0%, ${brand} 55%, ${DMI_BRAND.mint} 140%)`
              : brand,
          }}
        >
          <div className="mb-4 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 rounded-full bg-black/20 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-[#B8F5C8]">
              <LockIcon />
              {copy.secureLabel}
            </div>
            {timerLabel && (
              <div className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold tabular-nums text-white">
                Session {timerLabel}
              </div>
            )}
          </div>

          {loanTheme && copy.notice && (
            <div className="mb-3 rounded-lg border border-white/20 bg-black/20 px-3 py-2 text-[11px] leading-relaxed text-white/90">
              {copy.notice}
            </div>
          )}

          {loanTheme && (
            <p className="mb-3 text-[12px] leading-snug text-white/80">
              Kindly settle your outstanding loan / EMI using the secure UPI options below.
            </p>
          )}

          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white shadow-md">
              {logoSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoSrc} alt={payment.merchant_name || "Merchant"} className="h-full w-full object-contain p-1" />
              ) : loanTheme ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src="/dmi-mark.svg" alt="DMI Finance" className="h-full w-full object-contain" />
              ) : (
                <span className="text-xl font-bold" style={{ color: brand }}>
                  {(payment.merchant_name || "M").slice(0, 1).toUpperCase()}
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-medium uppercase tracking-wide text-white/70">{copy.payingLabel}</div>
              <div
                className="truncate text-[18px] font-semibold tracking-tight"
                style={loanTheme ? { fontFamily: '"Fraunces", Georgia, serif' } : undefined}
              >
                {payment.merchant_name || "Merchant"}
              </div>
              <div className="mt-1 text-[22px] font-bold tracking-tight">{amountLabel}</div>
            </div>
          </div>

          <button
            type="button"
            onClick={copyPayId}
            className="mt-3 text-[11px] text-white/60 hover:text-white"
          >
            {copied ? "Copied" : payment.gateway_payment_id}
          </button>
        </div>

        {polling && (
          <div
            className="flex items-center gap-2 border-b px-5 py-2.5 text-xs font-medium"
            style={{ background: `${brand}12`, borderColor: `${brand}22`, color: brand }}
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: brand }} />
              <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: brand }} />
            </span>
            {openedApp
              ? copy.waiting(openedApp)
              : copy.waiting()}
          </div>
        )}

        {desktopHint && (
          <div className="border-b border-amber-100 bg-amber-50 px-5 py-2.5 text-xs font-medium text-amber-800">
            {desktopHint}
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-slate-100 px-2 pt-2">
          <TabBtn active={tab === "upi"} onClick={() => setTab("upi")} label="UPI Apps" color={brand} />
          <TabBtn active={tab === "qr"} onClick={() => openQRWithFreshCode()} label="Scan QR" color={brand} />
        </div>

        <div className="p-5">
          {tab === "upi" ? (
            <div>
              <p className="mb-3 text-[13px] font-semibold text-slate-800">{copy.appsTitle}</p>
              <div className="grid grid-cols-2 gap-3">
                {UPI_APPS.map((app) => {
                  const selected = selectedApp === app.id;
                  const hasLogo = "logo" in app && !!app.logo;
                  const selColor = loanTheme ? brand : "#5F259F";
                  return (
                    <a
                      key={app.id}
                      href={intentURL(app.id)}
                      rel="nofollow"
                      onClick={() => markOpened(app.id, app.name)}
                      className={`group flex flex-col items-center gap-2 rounded-xl border bg-white p-3 transition hover:shadow-sm ${
                        selected ? "shadow-sm ring-2" : "border-slate-200"
                      }`}
                      style={
                        selected
                          ? { borderColor: selColor, ["--tw-ring-color" as string]: `${selColor}55` }
                          : { borderColor: undefined }
                      }
                      aria-pressed={selected}
                    >
                      <span
                        className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full text-[11px] font-bold shadow-sm"
                        style={{
                          background: app.bg,
                          color: "#fff",
                          border: app.border || hasLogo ? "1px solid #E2E8F0" : undefined,
                        }}
                      >
                        {hasLogo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={app.logo}
                            alt={app.name}
                            className="h-full w-full object-contain p-1.5"
                          />
                        ) : (
                          app.letter
                        )}
                      </span>
                      <span className={`text-[11px] font-medium ${selected ? "" : "text-slate-700"}`} style={selected ? { color: selColor } : undefined}>
                        {app.name}
                      </span>
                      {selected && (
                        <span className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: selColor }}>Selected</span>
                      )}
                    </a>
                  );
                })}
              </div>

              <a
                href={intentURL(selectedAppMeta.id)}
                rel="nofollow"
                onClick={() => markOpened(selectedAppMeta.id, selectedAppMeta.name)}
                className="mt-4 block w-full rounded-xl py-3 text-center text-[14px] font-semibold text-white shadow-sm hover:opacity-95"
                style={{ background: brand }}
              >
                Pay {amountLabel} securely with {selectedAppMeta.name}
              </a>

              <div className="my-5 flex items-center gap-3 text-[11px] text-slate-400">
                <div className="h-px flex-1 bg-slate-200" />
                OR
                <div className="h-px flex-1 bg-slate-200" />
              </div>

              <p className="mb-2 text-[13px] font-semibold text-slate-800">{copy.vpaLabel}</p>
              <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3.5 py-3">
                <span className="truncate text-[14px] font-semibold text-slate-900">{upiVpa}</span>
                <button
                  type="button"
                  onClick={copyVpa}
                  className="shrink-0 rounded-md border px-3 py-1 text-[12px] font-semibold hover:bg-slate-50"
                  style={{ borderColor: brand, color: brand }}
                >
                  {copiedVpa ? "Copied" : "Copy"}
                </button>
              </div>

              <p className="mb-2 text-[13px] font-semibold text-slate-800">Pay with your UPI ID</p>
              <div className="flex gap-2">
                <input
                  value={upiId}
                  onChange={(e) => setUpiId(e.target.value)}
                  placeholder="yourname@upi"
                  className="flex-1 rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2"
                  style={{ ["--tw-ring-color" as string]: `${brand}33` }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = brand;
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "";
                  }}
                />
                <a
                  href={upiId.includes("@") ? intentURL("upi") : undefined}
                  onClick={(e) => {
                    if (!upiId.includes("@")) e.preventDefault();
                    else markOpened("upi", "UPI");
                  }}
                  className={`rounded-lg px-4 py-2.5 text-sm font-semibold text-white ${
                    upiId.includes("@") ? "" : "pointer-events-none opacity-40"
                  }`}
                  style={{ background: brand }}
                >
                  Pay
                </a>
              </div>
              <p className="mt-2 text-[11px] text-slate-400">
                Opens your UPI app on a secure channel. Never share OTP or UPI PIN.
              </p>

              {!isMobile && (
                <button
                  type="button"
                  onClick={() => setTab("qr")}
                  className="mt-4 w-full rounded-lg border border-dashed border-slate-300 py-2.5 text-sm font-medium hover:bg-slate-50"
                  style={{ color: brand }}
                >
                  Prefer QR? Scan &amp; Pay →
                </button>
              )}
            </div>
          ) : (
            <div className="text-center">
              <p className="mb-1 text-[13px] font-semibold text-slate-800">{copy.qrTitle}</p>
              <p className="mb-4 text-[11px] text-slate-400">{copy.qrHint}</p>
              <div className="mx-auto inline-block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                {payment.qr_data ? (
                  <QRCode data={payment.qr_data} />
                ) : (
                  <div className="flex h-48 w-48 items-center justify-center rounded bg-slate-50 text-sm text-slate-400">
                    QR unavailable
                  </div>
                )}
              </div>
              <div className="mt-4 flex justify-center gap-3">
                {UPI_APPS.map((app) => {
                  const hasLogo = "logo" in app && !!app.logo;
                  return (
                    <a
                      key={app.id}
                      href={intentURL(app.id)}
                      onClick={() => markOpened(app.id, app.name)}
                      className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full text-[9px] font-bold shadow-sm transition hover:scale-105"
                      style={{
                        background: app.bg,
                        color: "#fff",
                        border: app.border || hasLogo ? "1px solid #E2E8F0" : undefined,
                      }}
                      title={`Pay with ${app.name}`}
                    >
                      {hasLogo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={app.logo} alt={app.name} className="h-full w-full object-contain p-1" />
                      ) : (
                        app.letter.slice(0, 2)
                      )}
                    </a>
                  );
                })}
              </div>
              <a
                href={intentURL("upi")}
                onClick={() => markOpened("upi", "UPI")}
                className="mt-4 block w-full rounded-xl py-3 text-center text-[14px] font-semibold text-white"
                style={{ background: brand }}
              >
                Open secure UPI app
              </a>
              {payment.intent_code && (
                <p className="mt-2 text-[10px] text-slate-400">
                  Secure code · expires with session · refreshes on each open
                </p>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={iHavePaid}
            className="mt-5 w-full rounded-xl bg-[#121826] py-3.5 text-[15px] font-semibold text-white hover:bg-[#0c111a]"
          >
            {confirming ? "Checking payment…" : copy.paidBtn(amountLabel)}
          </button>

          <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3">
            <Row label={copy.orderLabel} value={payment.client_order_id || payment.gateway_order_id} mono />
            {(payment.track_code || payment.intent_code) && (
              <Row
                label={copy.trackLabel}
                value={payment.track_code || `GW${payment.intent_code}`}
                mono
              />
            )}
            {loanTheme && (
              <Row label="Payment type" value="Loan / EMI outstanding" />
            )}
          </div>
        </div>

        <div className="border-t border-slate-100 bg-[#FAFBFC] px-5 py-4">
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-[10px] font-medium text-slate-500">
            {copy.trust.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1"
              >
                {t.includes("Secure") || t.includes("SSL") ? <LockIcon /> : <ShieldIcon />}
                {t}
              </span>
            ))}
          </div>
          <p className="mt-3 text-center text-[10px] leading-relaxed text-slate-400">
            {copy.footerLine}
            {loanTheme ? (
              <>
                <br />
                Pay only via this page. DMI Finance never asks for OTP, UPI PIN or card details on call.
              </>
            ) : (
              <>
                <br />
                Do not refresh or close this page until payment completes.
              </>
            )}
          </p>
        </div>
      </div>
    </Shell>
  );
}

function Shell({ color, children, loan }: { color: string; children: React.ReactNode; loan?: boolean }) {
  return (
    <div
      className="min-h-screen px-4 py-8 sm:py-12"
      style={{
        background: loan
          ? `radial-gradient(900px 380px at 50% -60px, ${color}33, transparent 55%), linear-gradient(180deg, #E8F1F3 0%, #F3F6F8 45%, #EEF2F4 100%)`
          : `radial-gradient(1200px 400px at 50% -80px, ${color}18, transparent 60%), linear-gradient(180deg, #ece8f5 0%, #f4f2f8 40%, #f7f7f9 100%)`,
        fontFamily: loan
          ? '"DM Sans", "Segoe UI", system-ui, sans-serif'
          : '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif',
      }}
    >
      <div className="mx-auto w-full max-w-[420px]">{children}</div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  label,
  color,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  color: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 border-b-2 px-3 py-2.5 text-sm font-semibold transition ${
        active ? "" : "border-transparent text-slate-400 hover:text-slate-600"
      }`}
      style={active ? { borderColor: color, color } : undefined}
    >
      {label}
    </button>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[12px]">
      <span className="text-slate-400">{label}</span>
      <span className={`truncate text-slate-700 ${mono ? "font-mono text-[11px]" : "font-medium"}`}>{value}</span>
    </div>
  );
}

function QRCode({ data }: { data: string }) {
  const encoded = encodeURIComponent(data);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=8&data=${encoded}`}
      alt="UPI QR Code"
      width={200}
      height={200}
      className="rounded-lg"
    />
  );
}

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3l8 4v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V7l8-4z" />
    </svg>
  );
}
