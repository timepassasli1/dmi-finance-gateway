"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { StatsCard } from "@/components/StatsCard";
import { formatCurrency } from "@/lib/utils";

interface Stats {
  total_clients: number;
  active_clients: number;
  pending_kyc: number;
  total_payments: number;
  success_payments: number;
  total_volume: number;
}

export default function AdminPage() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<Stats>("/v1/admin/stats")
      .then(setStats)
      .catch(() => router.push("/auth/login"))
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Platform Overview</h1>
        <p className="text-gray-500 text-sm mt-1">Gateway administrator dashboard</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <StatsCard title="Total Clients" value={stats?.total_clients || 0} />
        <StatsCard title="Active Clients" value={stats?.active_clients || 0} />
        <StatsCard title="Pending KYC" value={stats?.pending_kyc || 0} />
        <StatsCard title="Total Payments" value={stats?.total_payments || 0} />
        <StatsCard title="Successful" value={stats?.success_payments || 0} />
        <StatsCard title="Total Volume" value={formatCurrency(stats?.total_volume || 0)} />
      </div>

      <div className="grid grid-cols-3 gap-6">
        <a href="/admin/clients" className="bg-white rounded-xl border border-gray-200 p-5 hover:border-blue-300 transition-colors">
          <div className="font-semibold text-gray-900 mb-1">Manage Clients</div>
          <div className="text-sm text-gray-500">Review, approve, and manage client accounts</div>
        </a>
        <a href="/admin/processing-merchants" className="bg-white rounded-xl border border-gray-200 p-5 hover:border-blue-300 transition-colors">
          <div className="font-semibold text-gray-900 mb-1">Processing Merchants</div>
          <div className="text-sm text-gray-500">Configure payment processing backends</div>
        </a>
        <a href="/admin/routes" className="bg-white rounded-xl border border-gray-200 p-5 hover:border-blue-300 transition-colors">
          <div className="font-semibold text-gray-900 mb-1">Routing</div>
          <div className="text-sm text-gray-500">Assign clients to processing merchants</div>
        </a>
      </div>
    </div>
  );
}
