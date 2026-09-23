"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { StatsCard } from "@/components/StatsCard";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCurrency, formatDate } from "@/lib/utils";

interface Payment {
  gateway_payment_id: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
}

interface Wallet {
  available_balance: number;
  pending_balance: number;
  currency: string;
}

interface Client {
  business_name: string;
  status: string;
  kyc_status: string;
}

interface Stats {
  total_payments: number;
  success_payments: number;
  pending_payments: number;
  failed_payments: number;
  total_volume: number;
  today_volume: number;
}

interface SetupStatus {
  steps_complete: number;
  steps_total: number;
  ready: boolean;
}

export default function DashboardPage() {
  const router = useRouter();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<{ payments: Payment[]; total: number }>("/v1/client/payments?limit=5"),
      api.get<Wallet>("/v1/client/wallet"),
      api.get<Client>("/v1/client/profile"),
      api.get<Stats>("/v1/client/stats"),
      api.get<SetupStatus>("/v1/client/setup-status"),
    ])
      .then(([p, w, c, st, su]) => {
        setPayments(p.payments || []);
        setWallet(w);
        setClient(c);
        setStats(st);
        setSetup(su);
      })
      .catch(() => router.push("/auth/login"))
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          Welcome, {client?.business_name}
        </h1>
        <div className="flex items-center space-x-2 mt-1">
          <StatusBadge status={client?.status || "PENDING"} />
          <span className="text-sm text-gray-500">KYC: </span>
          <StatusBadge status={client?.kyc_status || "NOT_SUBMITTED"} />
        </div>
      </div>

      {setup && !setup.ready && (
        <div className="mb-6 bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center justify-between">
          <p className="text-blue-900 text-sm">
            Setup {setup.steps_complete}/{setup.steps_total} complete — finish onboarding to go live.
          </p>
          <Link href="/dashboard/setup" className="text-sm text-blue-700 font-medium hover:underline">
            Continue setup →
          </Link>
        </div>
      )}

      {client?.status !== "ACTIVE" && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-amber-800 text-sm font-medium">
            Your account is pending activation.{" "}
            <a href="/dashboard/documents" className="underline">Upload documents</a> to complete KYC.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatsCard title="Available Balance" value={formatCurrency(wallet?.available_balance || 0)} />
        <StatsCard title="Successful" value={stats?.success_payments ?? 0} subtitle="all time" />
        <StatsCard title="Pending" value={stats?.pending_payments ?? 0} subtitle="open" />
        <StatsCard title="Today's Volume" value={formatCurrency(stats?.today_volume || 0)} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Recent Payments</h2>
          <a href="/dashboard/payments" className="text-sm text-blue-600 hover:underline">View all</a>
        </div>
        <div className="divide-y divide-gray-50">
          {payments.length === 0 && (
            <div className="px-6 py-8 text-center text-gray-400 text-sm">
              No payments yet. <a href="/dashboard/payment-links" className="text-blue-600 hover:underline">Create a payment link</a> to test.
            </div>
          )}
          {payments.map(p => (
            <div key={p.gateway_payment_id} className="px-6 py-4 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-900">{p.gateway_payment_id}</div>
                <div className="text-xs text-gray-400">{formatDate(p.created_at)}</div>
              </div>
              <div className="flex items-center space-x-3">
                <span className="text-sm font-medium">{formatCurrency(p.amount)}</span>
                <StatusBadge status={p.status} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
