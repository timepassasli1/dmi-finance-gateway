"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { gatewayApiUrl, gatewaySiteUrl } from "@/lib/gateway-config";
import { CodeBlock } from "@/components/CodeBlock";

interface APIKey {
  public_key: string;
  key_name: string;
}

export default function IntegrationPage() {
  const [publicKey, setPublicKey] = useState("pk_live_YOUR_PUBLIC_KEY");
  const [apiBase, setApiBase] = useState("https://gpzes.com/gw");
  const [siteBase, setSiteBase] = useState("https://gpzes.com");

  useEffect(() => {
    setApiBase(gatewayApiUrl());
    setSiteBase(gatewaySiteUrl());
    api.get<{ api_keys: APIKey[] }>("/v1/client/api-keys")
      .then((d) => {
        const k = d.api_keys?.[0];
        if (k?.public_key) setPublicKey(k.public_key);
      })
      .catch(() => {});
  }, []);

  const createOrder = `// Your server — never expose sk_live_ in browser
const res = await fetch("${apiBase}/v1/orders", {
  method: "POST",
  headers: {
    "Authorization": "Bearer sk_live_YOUR_SECRET_KEY",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    order_id: "ORDER_10001",       // your unique order id
    amount: 50000,                 // paise (₹500.00 = 50000)
    currency: "INR",
    customer: {
      name: "Customer Name",
      email: "customer@example.com",
      phone: "9999999999",
    },
  }),
});
const order = await res.json();
// order.gateway_order_id → use in next step
// order.status → "CREATED"`;

  const initiatePay = `// Still on your server (secret key required)
const payRes = await fetch(
  \`${apiBase}/v1/orders/\${order.gateway_order_id}/pay\`,
  {
    method: "POST",
    headers: {
      "Authorization": "Bearer sk_live_YOUR_SECRET_KEY",
      "Content-Type": "application/json",
    },
  }
);
const payment = await payRes.json();
// payment.payment_url → redirect customer here
// payment.gateway_payment_id → save for polling
// payment.track_code → e.g. GWXXXXXXXX (UPI remark)
// payment.status → "PENDING"`;

  const redirectCustomer = `// Option A — redirect to hosted checkout (recommended)
window.location.href = payment.payment_url;
// e.g. ${siteBase}/pay/PAY_xxxxx

// Option B — open in new tab
window.open(payment.payment_url, "_blank");

// Option C — embed QR on your page (public, no secret key)
const page = await fetch(
  \`${apiBase}/v1/pay/\${payment.gateway_payment_id}\`
).then(r => r.json());
// page.qr_data, page.track_code, page.merchant_upi_vpa, page.status`;

  const verifyPayment = `// Poll server-to-server until SUCCESS / FAILED (do NOT fulfill on PENDING)
async function waitForPayment(gatewayPaymentId) {
  for (let i = 0; i < 60; i++) {
    const verify = await fetch(
      \`${apiBase}/v1/payments/\${gatewayPaymentId}/verify\`,
      {
        method: "POST",
        headers: {
          "Authorization": "Bearer sk_live_YOUR_SECRET_KEY",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gateway_payment_id: gatewayPaymentId }),
      }
    );
    const result = await verify.json();
    // result.status: PENDING | SUCCESS | FAILED | EXPIRED | PENDING_REVIEW
    if (result.status === "SUCCESS") return result;
    if (result.status === "FAILED" || result.status === "EXPIRED") {
      throw new Error(result.message || result.status);
    }
    await new Promise((r) => setTimeout(r, 5000)); // poll every 5s
  }
  throw new Error("Payment still pending");
}

// Same status via GET:
// GET ${apiBase}/v1/payments/{gateway_payment_id}
// Authorization: Bearer sk_live_...`;

  const webhookVerify = `// Node.js — verify webhook signature from your endpoint secret (whsec_)
const crypto = require("crypto");

function verifyWebhook(rawBody, signatureHeader, timestampHeader, secret) {
  const payload = \`\${timestampHeader}.\${rawBody}\`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  const sig = (signatureHeader || "").replace(/^v1=/, "");
  return crypto.timingSafeEqual(
    Buffer.from(expected, "utf8"),
    Buffer.from(sig, "utf8")
  );
}

// Headers sent by gateway:
// X-Gateway-Signature: v1=<hmac>
// X-Gateway-Timestamp: <unix seconds>
// X-Gateway-Event-ID: <id>
// Event body includes gateway_payment_id + status (e.g. payment.success)`;

  const phpExample = `<?php
// PHP — create order + redirect to pay page
$ch = curl_init("${apiBase}/v1/orders");
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => [
    "Authorization: Bearer sk_live_YOUR_SECRET_KEY",
    "Content-Type: application/json",
  ],
  CURLOPT_POSTFIELDS => json_encode([
    "order_id" => "ORDER_" . time(),
    "amount" => 50000,
    "currency" => "INR",
    "customer" => ["name" => "Customer", "email" => "c@example.com"],
  ]),
]);
$order = json_decode(curl_exec($ch), true);
curl_close($ch);

$ch = curl_init("${apiBase}/v1/orders/" . $order["gateway_order_id"] . "/pay");
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => [
    "Authorization: Bearer sk_live_YOUR_SECRET_KEY",
  ],
]);
$payment = json_decode(curl_exec($ch), true);
header("Location: " . $payment["payment_url"]);
exit;`;

  const endpoints = [
    ["POST", "/v1/orders", "Create order", "sk_live_"],
    ["POST", "/v1/orders/{gateway_order_id}/pay", "Start payment → payment_url", "sk_live_"],
    ["GET", "/v1/payments/{gateway_payment_id}", "Get payment status", "sk_live_"],
    ["POST", "/v1/payments/{gateway_payment_id}/verify", "Poll status (no auto-credit)", "sk_live_"],
    ["GET", "/v1/pay/{gateway_payment_id}", "Public pay-page / QR data", "none"],
  ];

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Integration Guide</h1>
        <p className="text-gray-500 text-sm mt-1">
          Wire UPI checkout into your website using REST API + hosted pay page
        </p>
      </div>

      <div className="mb-6 bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-900">
        <p className="font-medium mb-2">Before you start</p>
        <ol className="list-decimal list-inside space-y-1 text-blue-800">
          <li>
            Generate keys on{" "}
            <Link href="/dashboard/api-keys" className="underline font-medium">API Keys</Link>
            {" "}(save <code className="bg-blue-100 px-1 rounded">sk_live_</code> on your server only — shown once)
          </li>
          <li>
            Add a webhook on{" "}
            <Link href="/dashboard/webhooks" className="underline font-medium">Webhooks</Link>
            {" "}for instant payment.success notifications
          </li>
          <li>Use <code className="bg-blue-100 px-1 rounded">{apiBase}</code> as your API base URL</li>
        </ol>
      </div>

      <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-950">
        <p className="font-medium mb-1">How confirmation works</p>
        <p className="text-amber-900">
          Customer pays via UPI with remark <code className="bg-amber-100 px-1 rounded">GWxxxxxxxx</code>.
          The Paytm Business watcher (browser extension) matches that track and marks the payment{" "}
          <strong>SUCCESS</strong>. Your <code className="bg-amber-100 px-1 rounded">/verify</code> call
          only returns the current status — it will stay <strong>PENDING</strong> until that confirmation.
          Never ship / credit the user on PENDING.
        </p>
      </div>

      <div className="space-y-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 mb-2">Quick reference</h2>
          <div className="grid sm:grid-cols-2 gap-3 text-sm mb-4">
            <div><span className="text-gray-500">API base</span><br /><code className="text-gray-800">{apiBase}</code></div>
            <div><span className="text-gray-500">Pay page</span><br /><code className="text-gray-800">{siteBase}/pay/PAY_xxx</code></div>
            <div><span className="text-gray-500">Your public key</span><br /><code className="text-gray-800 text-xs break-all">{publicKey}</code></div>
            <div><span className="text-gray-500">Auth header</span><br /><code className="text-gray-800">Authorization: Bearer sk_live_...</code></div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="text-gray-500 border-b border-gray-100">
                  <th className="py-2 pr-3 font-medium">Method</th>
                  <th className="py-2 pr-3 font-medium">Path</th>
                  <th className="py-2 pr-3 font-medium">Use</th>
                  <th className="py-2 font-medium">Auth</th>
                </tr>
              </thead>
              <tbody>
                {endpoints.map(([method, path, use, auth]) => (
                  <tr key={path as string} className="border-b border-gray-50">
                    <td className="py-2 pr-3 font-mono text-xs text-blue-700">{method}</td>
                    <td className="py-2 pr-3 font-mono text-xs text-gray-800 break-all">{path}</td>
                    <td className="py-2 pr-3 text-gray-600">{use}</td>
                    <td className="py-2 text-gray-500 text-xs">{auth}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500 mt-3">
            Also accepted: <code className="bg-gray-100 px-1 rounded">X-API-Key: sk_live_...</code>
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <CodeBlock title="Step 1 — Create order (server-side)" code={createOrder} />
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <CodeBlock title="Step 2 — Initiate payment & get pay URL (server-side)" code={initiatePay} />
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <CodeBlock title="Step 3 — Send customer to checkout" code={redirectCustomer} />
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <CodeBlock title="Step 4 — Poll verify until SUCCESS (server-side)" code={verifyPayment} />
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <CodeBlock title="Step 5 — Verify webhook signatures" code={webhookVerify} />
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <CodeBlock title="PHP example (create + redirect)" code={phpExample} />
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <h3 className="font-semibold text-amber-900 mb-2">Security rules</h3>
          <ul className="text-sm text-amber-800 space-y-1 list-disc list-inside">
            <li>Never put <code className="bg-amber-100 px-1 rounded">sk_live_</code> in browser JavaScript or mobile apps</li>
            <li>Always poll / webhook-confirm <strong>SUCCESS</strong> before shipping / crediting</li>
            <li>Validate webhook signatures with the endpoint <code className="bg-amber-100 px-1 rounded">signing_secret</code> shown once at registration</li>
            <li>Amount is in <strong>paise</strong> (₹500 = 50000)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
