"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/utils";

interface Log {
  id: string;
  action: string;
  actor_type: string;
  entity_type: string;
  entity_id: string;
  client_id: string;
  ip_address: string;
  created_at: string;
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<{ logs: Log[] }>("/v1/admin/audit-logs").then(d => setLogs(d.logs || [])).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Audit Logs</h1>
        <p className="text-gray-500 text-sm mt-1">Complete audit trail of platform actions</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="divide-y divide-gray-50">
          {logs.length === 0 && <div className="px-6 py-8 text-center text-gray-400">No audit logs</div>}
          {logs.map(l => (
            <div key={l.id} className="px-6 py-3 flex items-center justify-between">
              <div>
                <span className="text-sm font-medium text-gray-800">{l.action}</span>
                {l.entity_type && <span className="text-xs text-gray-400 ml-2">{l.entity_type}: {l.entity_id?.slice(0,8)}</span>}
              </div>
              <div className="text-xs text-gray-400">{formatDate(l.created_at)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
