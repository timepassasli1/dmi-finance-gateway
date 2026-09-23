"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";

interface SetupStatus {
  profile_complete: boolean;
  documents_uploaded: boolean;
  has_api_key: boolean;
  has_webhook: boolean;
  has_success_payment: boolean;
  account_active: boolean;
  steps_complete: number;
  steps_total: number;
  ready: boolean;
}

interface Client {
  business_name: string;
  status: string;
  kyc_status: string;
}

const steps = [
  { key: "profile_complete", title: "Complete profile", desc: "Business name, phone, branding", href: "/dashboard/settings" },
  { key: "documents_uploaded", title: "Upload KYC documents", desc: "PAN, GST, bank proof", href: "/dashboard/documents" },
  { key: "has_api_key", title: "Generate API keys", desc: "Secret key for server-side orders", href: "/dashboard/api-keys" },
  { key: "has_webhook", title: "Configure webhook", desc: "Receive payment.success events", href: "/dashboard/webhooks" },
  { key: "has_success_payment", title: "Test payment", desc: "Create a link and complete one payment", href: "/dashboard/payment-links" },
  { key: "ready", title: "Integrate on your website", desc: "API examples for your site backend", href: "/dashboard/integration" },
] as const;

export default function SetupPage() {
  const router = useRouter();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<SetupStatus>("/v1/client/setup-status"),
      api.get<Client>("/v1/client/profile"),
    ])
      .then(([s, c]) => {
        setStatus(s);
        setClient(c);
      })
      .catch(() => router.push("/auth/login"))
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;

  const doneCount = steps.filter((step) =>
    step.key === "ready"
      ? status?.ready === true
      : status
        ? status[step.key as keyof SetupStatus] === true
        : false
  ).length;
  const pct = status ? Math.round((doneCount / steps.length) * 100) : 0;

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Get Started</h1>
        <p className="text-gray-500 text-sm mt-1">
          Complete these steps to go live with {client?.business_name}
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-gray-700">
            {doneCount} of {steps.length} complete
          </span>
          <div className="flex items-center gap-2">
            <StatusBadge status={client?.status || "PENDING"} />
            {status?.ready && (
              <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full font-medium">Ready to go live</span>
            )}
          </div>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="space-y-3">
        {steps.map((step, i) => {
          const done =
            step.key === "ready"
              ? status?.ready === true
              : status
                ? status[step.key as keyof SetupStatus] === true
                : false;
          return (
            <div
              key={step.key}
              className={`bg-white rounded-xl border p-5 flex items-center gap-4 ${
                done ? "border-green-200" : "border-gray-200"
              }`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                  done ? "bg-green-600 text-white" : "bg-gray-100 text-gray-500"
                }`}
              >
                {done ? "✓" : i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-gray-900">{step.title}</div>
                <div className="text-sm text-gray-500">{step.desc}</div>
              </div>
              <Link
                href={step.href}
                className="text-sm text-blue-600 hover:underline shrink-0"
              >
                {done ? "Review" : "Start"}
              </Link>
            </div>
          );
        })}
      </div>

      {status?.ready && (
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-xl p-4">
          <p className="text-blue-900 text-sm">
            You&apos;re all set! Check the{" "}
            <Link href="/dashboard/integration" className="underline font-medium">integration guide</Link>{" "}
            to wire payments into your site.
          </p>
        </div>
      )}

      {!status?.account_active && (
        <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          Account activation pending — upload documents and wait for admin approval.
        </div>
      )}
    </div>
  );
}
