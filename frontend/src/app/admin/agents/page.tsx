"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate } from "@/lib/utils";

interface Agent {
  id: string;
  agent_code: string;
  display_name: string;
  status: string;
  last_heartbeat_at: string;
  ip_address: string;
  version: string;
  created_at: string;
}

export default function AdminAgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<{ agents: Agent[] }>("/v1/admin/agents").then(d => setAgents(d.agents || [])).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Verification Agents</h1>
        <p className="text-gray-500 text-sm mt-1">Deployed verification agents and their health</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Agent</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Last Heartbeat</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">IP</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Version</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {agents.length === 0 && <tr><td colSpan={5} className="text-center py-12 text-gray-400">No agents registered</td></tr>}
            {agents.map(a => (
              <tr key={a.id}>
                <td className="px-6 py-4">
                  <div className="font-medium text-sm text-gray-900">{a.display_name}</div>
                  <code className="text-xs text-gray-400">{a.agent_code}</code>
                </td>
                <td className="px-6 py-4"><StatusBadge status={a.status} /></td>
                <td className="px-6 py-4 text-xs text-gray-400">{a.last_heartbeat_at ? formatDate(a.last_heartbeat_at) : "Never"}</td>
                <td className="px-6 py-4 text-xs text-gray-400">{a.ip_address || "-"}</td>
                <td className="px-6 py-4 text-xs text-gray-400">{a.version || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
