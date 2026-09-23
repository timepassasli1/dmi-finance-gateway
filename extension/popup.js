async function load() {
  const cfg = await chrome.storage.sync.get({
    enabled: true,
    gatewayUrl: "https://gpzes.com/gw",
    agentCode: "AGENT_VIVEK",
    agentSecret: "YOUR_AGENT_SECRET",
    lastPaymentId: "",
    lastResult: null,
    autoApprove: true,
  });
  // Auto-fix bad local defaults
  if (!cfg.gatewayUrl || /127\.0\.0\.1|localhost/i.test(cfg.gatewayUrl)) {
    cfg.gatewayUrl = "https://gpzes.com/gw";
    await chrome.storage.sync.set({ gatewayUrl: cfg.gatewayUrl });
  }
  if (!cfg.agentCode || cfg.agentCode === "EXT_WATCHER_01") {
    cfg.agentCode = "AGENT_VIVEK";
    cfg.agentSecret = "YOUR_AGENT_SECRET";
    await chrome.storage.sync.set({ agentCode: cfg.agentCode, agentSecret: cfg.agentSecret });
  }
  document.getElementById("enabled").checked = !!cfg.enabled;
  document.getElementById("autoApprove").checked = cfg.autoApprove !== false;
  document.getElementById("gatewayUrl").value = cfg.gatewayUrl || "";
  document.getElementById("agentCode").value = cfg.agentCode || "";
  document.getElementById("agentSecret").value = cfg.agentSecret || "";
  document.getElementById("lastPaymentId").value = cfg.lastPaymentId || "";
  if (cfg.lastResult) {
    document.getElementById("last").textContent = JSON.stringify(cfg.lastResult, null, 2);
  }
  refreshStats();
}

function setStatus(msg, isErr) {
  const el = document.getElementById("status");
  el.textContent = msg;
  el.className = "status" + (isErr ? " err" : "");
}

async function save() {
  const payload = {
    enabled: document.getElementById("enabled").checked,
    autoApprove: document.getElementById("autoApprove").checked,
    gatewayUrl: document.getElementById("gatewayUrl").value.trim().replace(/\/$/, ""),
    agentCode: document.getElementById("agentCode").value.trim(),
    agentSecret: document.getElementById("agentSecret").value.trim(),
    lastPaymentId: document.getElementById("lastPaymentId").value.trim(),
  };
  await chrome.storage.sync.set(payload);
  setStatus(`Saved · ${payload.enabled ? "ON" : "OFF"}`);
  chrome.runtime.sendMessage({ type: "CONFIG_UPDATED" });
  return payload;
}

function refreshStats() {
  chrome.runtime.sendMessage({ type: "GET_PENDING" }, (data) => {
    if (!data) return;
    document.getElementById("pendingCount").textContent =
      data.pendingCount ?? (data.pendingPayments || []).length;
    document.getElementById("merchantTabs").textContent = data.attachedTabId ? "1" : "0";
    document.getElementById("watchState").textContent = document.getElementById("enabled").checked
      ? "ON"
      : "OFF";
    document.getElementById("lastPoll").textContent = data.lastPollAt
      ? `Last poll: ${new Date(data.lastPollAt).toLocaleTimeString()}`
      : data.lastError
        ? `Error: ${data.lastError}`
        : "Not polled yet";
    document.getElementById("attachMeta").textContent = data.attachedTabId
      ? `Attached tab #${data.attachedTabId}`
      : "Attached tab: none — pehle Attach dabao";
    const list = data.pendingPayments || [];
    const hist = data.watchHistory || [];
    const pendingEl = document.getElementById("pendingList");
    if (pendingEl) {
      const pendingBlock = list.length
        ? list
            .slice(0, 6)
            .map((p) => {
              const amt = `₹${(Number(p.amount) / 100).toFixed(2)}`;
              const t = p.track_code || p.upi_note || "";
              const w = p.watched || p.last_watched_at ? "●" : "○";
              return `${w} ${amt}  ${t}  PENDING`;
            })
            .join("\n")
        : "No pending";
      const histBlock = hist.length
        ? "\n— history —\n" +
          hist
            .slice(0, 6)
            .map((p) => {
              const amt = `₹${(Number(p.amount) / 100).toFixed(2)}`;
              const t = p.track_code || p.upi_note || "";
              return `${amt}  ${t}  ${p.status}`;
            })
            .join("\n")
        : "";
      pendingEl.textContent = pendingBlock + histBlock;
    }
    if (data.eventLog?.[0]) {
      document.getElementById("last").textContent = JSON.stringify(data.eventLog[0], null, 2);
    }
  });
}

async function manual(status) {
  const cfg = await save();
  const rupees = Number(document.getElementById("manualAmount").value || 0);
  const amountPaise = rupees > 0 ? Math.round(rupees * 100) : 0;
  chrome.runtime.sendMessage(
    {
      type: "MANUAL_SUBMIT",
      outcome: {
        status,
        gateway_payment_id: cfg.lastPaymentId || "",
        amount: amountPaise,
        currency: "INR",
        provider: "manual",
        source: "extension",
        provider_transaction_ref: `MANUAL_${status}_${Date.now()}`,
      },
    },
    (resp) => {
      if (chrome.runtime.lastError) {
        setStatus(chrome.runtime.lastError.message, true);
        return;
      }
      if (resp?.ok) {
        setStatus(`${status}: ${resp.message}`);
        load();
      } else {
        setStatus(resp?.error || "Failed", true);
      }
    }
  );
}

document.getElementById("enabled").addEventListener("change", save);
document.getElementById("autoApprove").addEventListener("change", save);

document.getElementById("attach").addEventListener("click", () => {
  setStatus("Attach: Paytm refresh + inject… (~3s)");
  chrome.runtime.sendMessage({ type: "ATTACH_ACTIVE_TAB" }, (resp) => {
    if (chrome.runtime.lastError) {
      setStatus(chrome.runtime.lastError.message, true);
      return;
    }
    setStatus(
      resp?.ok ? "Attached — ab popup dubara mat kholna, khud chalega" : resp?.error || "Failed",
      !resp?.ok
    );
    setTimeout(refreshStats, 500);
  });
});

document.getElementById("detach").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "DETACH" }, () => {
    setStatus("Detached");
    refreshStats();
  });
});

document.getElementById("tick").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "FORCE_TICK" }, () => {
    setStatus("Scan triggered");
    setTimeout(refreshStats, 600);
  });
});

document.getElementById("openPaytm").addEventListener("click", () => {
  chrome.tabs.create({ url: "https://dashboard.paytm.com/" });
});

document.getElementById("testSuccess").addEventListener("click", () => manual("SUCCESS"));
document.getElementById("testFailed").addEventListener("click", () => manual("FAILED"));

document.getElementById("testConn")?.addEventListener("click", async () => {
  const cfg = await save();
  setStatus("Testing gateway…");
  try {
    const base = cfg.gatewayUrl.replace(/\/$/, "");
    const res = await fetch(`${base}/v1/agents/pending-payments`, {
      headers: {
        "X-Agent-Code": cfg.agentCode,
        "X-Agent-Secret": cfg.agentSecret,
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(`Fetch FAIL HTTP ${res.status}: ${data?.error?.message || res.statusText}`, true);
      return;
    }
    const n = (data.payments || []).length;
    setStatus(`OK · pending ${n} · ${cfg.gatewayUrl}`);
    chrome.runtime.sendMessage({ type: "FORCE_TICK" });
    setTimeout(refreshStats, 500);
  } catch (e) {
    setStatus(`Fetch FAIL: ${e.message || e} (check Gateway URL + permissions)`, true);
  }
});

load();
setInterval(refreshStats, 2500);
