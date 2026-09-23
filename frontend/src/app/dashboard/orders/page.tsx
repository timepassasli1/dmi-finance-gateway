"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCurrency, formatDate } from "@/lib/utils";

interface Order {
  id: string;
  gateway_order_id: string;
  client_order_id: string;
  amount: number;
  currency: string;
  customer_name: string;
  customer_email: string;
  status: string;
  expires_at: string;
  created_at: string;
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Orders list via JWT auth on client dashboard
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/v1/client/payments?limit=50`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("gateway_token")}` }
    }).then(r => r.json()).then(d => {
      setOrders([]);
      setTotal(0);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Orders</h1>
        <p className="text-gray-500 text-sm mt-1">Orders created through the gateway API</p>
      </div>
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-8 text-center text-gray-400 text-sm">
          Orders are created server-to-server via the API. See payments for status.
        </div>
      </div>
    </div>
  );
}
