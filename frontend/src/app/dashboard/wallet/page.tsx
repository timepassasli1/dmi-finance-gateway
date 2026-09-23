"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { StatsCard } from "@/components/StatsCard";

interface Wallet {
  available_balance: number;
  pending_balance: number;
  currency: string;
  status: string;
}

export default function WalletPage() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<Wallet>("/v1/client/wallet").then(setWallet).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;
  if (!wallet) return <div className="p-8 text-red-500">Wallet not found</div>;

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Wallet</h1>
        <p className="text-gray-500 text-sm mt-1">Your ledger balance — accounting representation only</p>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <StatsCard title="Available Balance" value={formatCurrency(wallet.available_balance)} subtitle={wallet.currency} />
        <StatsCard title="Pending Balance" value={formatCurrency(wallet.pending_balance)} subtitle="Under processing" />
        <StatsCard title="Status" value={wallet.status} />
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <h3 className="font-medium text-blue-900 text-sm mb-1">Important Note</h3>
        <p className="text-blue-700 text-sm">
          The wallet balance is an internal accounting/ledger representation of processed payments.
          It is not a bank account. Actual settlement to your bank account is processed separately
          through authorized payment aggregator settlement flows.
        </p>
      </div>
    </div>
  );
}
