// Gateway verifier background — never injects into Paytm unless user clicks Attach.

const DEFAULTS = {
  gatewayUrl: "https://gpzes.com/gw",
  agentCode: "AGENT_VIVEK",
  agentSecret: "YOUR_AGENT_SECRET",
  enabled: true,
  autoApprove: true,
  pollSeconds: 8,
  lastPaymentId: "",
};

const processedKeys = new Set();
let reloadInFlight = false;
let lastReloadAt = 0;

async function getConfig() {
  return { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
}

async function setBadge(text, color) {
  try {
    await chrome.action.setBadgeText({ text: text || "" });
    if (color) await chrome.action.setBadgeBackgroundColor({ color });
  } catch (_) {}
}

async function fetchWatchHistory(cfg) {
  const res = await fetch(`${cfg.gatewayUrl.replace(/\/$/, "")}/v1/agents/watch-history`, {
    headers: {
      "X-Agent-Code": cfg.agentCode,
      "X-Agent-Secret": cfg.agentSecret,
    },
  });
  if (!res.ok) throw new Error(`watch-history HTTP ${res.status}`);
  const data = await res.json();
  return data.payments || [];
}

async function fetchPending(cfg) {
  const res = await fetch(`${cfg.gatewayUrl.replace(/\/$/, "")}/v1/agents/pending-payments`, {
    headers: {
      "X-Agent-Code": cfg.agentCode,
      "X-Agent-Secret": cfg.agentSecret,
    },
  });
  if (!res.ok) throw new Error(`pending HTTP ${res.status}`);
  const data = await res.json();
  return data.payments || [];
}

async function heartbeat(cfg) {
  try {
    await fetch(`${cfg.gatewayUrl.replace(/\/$/, "")}/v1/agents/heartbeat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Agent-Code": cfg.agentCode,
        "X-Agent-Secret": cfg.agentSecret,
      },
      body: JSON.stringify({ status: "online", version: "3.6.6" }),
    });
  } catch (_) {}
}

async function enrichFromPending(outcome, cfg) {
  if (outcome.gateway_payment_id || outcome.merchant_order_id) return outcome;
  try {
    const pending = await fetchPending(cfg);
    if (outcome.track_code) {
      const t = String(outcome.track_code).toUpperCase();
      const hit = pending.find(
        (p) =>
          String(p.track_code || "").toUpperCase() === t ||
          String(p.upi_note || "").toUpperCase() === t ||
          String(p.intent_code || "").toUpperCase() === t.replace(/^GW/, "")
      );
      if (hit?.gateway_payment_id) {
        outcome.gateway_payment_id = hit.gateway_payment_id;
        if (!outcome.amount) outcome.amount = hit.amount;
        return outcome;
      }
    }
    // Amount-only enrich disabled — same-time same-amount would mis-credit
  } catch (_) {}
  return outcome;
}

async function postVerification(outcome, cfg) {
  outcome = await enrichFromPending({ ...outcome }, cfg);
  const paymentId = outcome.gateway_payment_id || cfg.lastPaymentId || "";
  const body = {
    gateway_payment_id: paymentId,
    merchant_order_id: outcome.merchant_order_id || "",
    provider_transaction_ref:
      outcome.provider_transaction_ref || `EXT_${Date.now()}`,
    amount: outcome.amount || 0,
    currency: outcome.currency || "INR",
    status: outcome.status,
    timestamp: Math.floor(Date.now() / 1000),
    source: "extension",
    track_code: outcome.track_code || "",
    remarks: outcome.remarks || outcome.raw_snippet || "",
    raw_snippet: outcome.raw_snippet || "",
  };

  if (!body.track_code && !body.gateway_payment_id && !body.merchant_order_id) {
    return { ok: false, error: "Need GW track from Paytm remarks — amount-only / History-page verify disabled" };
  }

  const res = await fetch(`${cfg.gatewayUrl.replace(/\/$/, "")}/v1/agents/verification-event`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Code": cfg.agentCode,
      "X-Agent-Secret": cfg.agentSecret,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data?.error?.message || `HTTP ${res.status}` };

  const entry = {
    at: new Date().toISOString(),
    status: data.status || outcome.status,
    gateway_payment_id: data.gateway_payment_id || paymentId,
    message: data.message || "ok",
    amount: body.amount,
  };
  await chrome.storage.sync.set({ lastResult: entry });
  const log = (await chrome.storage.local.get({ eventLog: [] })).eventLog || [];
  log.unshift(entry);
  await chrome.storage.local.set({ eventLog: log.slice(0, 30) });

  const st = (entry.status || "").toUpperCase();
  await setBadge(
    st === "SUCCESS" ? "OK" : st === "FAILED" ? "X" : "!",
    st === "SUCCESS" ? "#16a34a" : "#dc2626"
  );
  return { ok: true, message: entry.message, data };
}

async function getAttachedTabId() {
  const { attachedTabId } = await chrome.storage.local.get({ attachedTabId: null });
  return attachedTabId;
}

async function waitTabComplete(tabId, timeoutMs = 30000) {
  const cur = await chrome.tabs.get(tabId);
  if (cur.status === "complete") return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error("Page load timeout"));
    }, timeoutMs);
    const onUpdated = (id, info) => {
      if (id !== tabId || info.status !== "complete") return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function enablePersistentWatch() {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: ["gw-watch"] }).catch(() => {});
    await chrome.scripting.registerContentScripts([
      {
        id: "gw-watch",
        matches: [
          "https://dashboard.paytm.com/*",
          "https://business.paytm.com/*",
        ],
        js: ["src/watch.js"],
        runAt: "document_idle",
        allFrames: false,
        persistAcrossSessions: true,
      },
    ]);
  } catch (_) {
    /* older chrome / permission — executeScript fallback still works */
  }
}

async function disablePersistentWatch() {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: ["gw-watch"] });
  } catch (_) {}
}

/** Harvest GW notes from Paytm XHR/fetch (MAIN world). */
async function injectPaytmNetworkHook(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        if (window.__GW_PAYTM_NET_HOOK__) return;
        window.__GW_PAYTM_NET_HOOK__ = true;
        const emit = (text) => {
          try {
            if (!text || text.length < 8) return;
            if (!/GW[A-Fa-f0-9]{8}|PAY_/i.test(text)) return;
            window.postMessage(
              { source: "GW_PAYTM_NET", text: String(text).slice(0, 400000) },
              "*"
            );
          } catch (_) {}
        };
        const ofetch = window.fetch;
        window.fetch = async function (...args) {
          const res = await ofetch.apply(this, args);
          try {
            const u = String(args[0]?.url || args[0] || "");
            if (/txn|transaction|payment|order|history|upi|settlement|passbook|ledger|report/i.test(u)) {
              res.clone().text().then(emit).catch(() => {});
            }
          } catch (_) {}
          return res;
        };
        const XO = XMLHttpRequest.prototype.open;
        const XS = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (method, url, ...rest) {
          this.__gw_url = url;
          return XO.call(this, method, url, ...rest);
        };
        XMLHttpRequest.prototype.send = function (...args) {
          this.addEventListener("load", function () {
            try {
              const u = String(this.__gw_url || "");
              if (/txn|transaction|payment|order|history|upi|settlement|passbook|ledger|report/i.test(u)) {
                emit(this.responseText || "");
              }
            } catch (_) {}
          });
          return XS.apply(this, args);
        };
      },
    });
  } catch (_) {
    /* ignore — content script still works */
  }
}

async function injectAndStart(tabId, { clearOpened = false } = {}) {
  const NEED_VERSION = "3.6.6";
  let alive = false;
  let version = "";
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: "PING" });
    alive = !!(pong && pong.ok);
    version = String(pong?.version || "");
  } catch (_) {}

  // Always re-inject when version mismatch (extension reload left old script)
  if (!alive || version !== NEED_VERSION) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ["src/watch.js"],
        });
        await new Promise((r) => setTimeout(r, 400 + attempt * 300));
        try {
          const pong = await chrome.tabs.sendMessage(tabId, { type: "PING" });
          if (pong?.ok && String(pong.version || "") === NEED_VERSION) {
            alive = true;
            version = NEED_VERSION;
            break;
          }
        } catch (_) {}
      } catch (_) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }

  if (!alive) return;

  await injectPaytmNetworkHook(tabId);

  const cfg = await getConfig();
  const pending = await fetchPending(cfg).catch(() => []);
  try {
    await chrome.tabs.sendMessage(tabId, { type: "WATCHLIST", payments: pending });
    await chrome.tabs.sendMessage(tabId, {
      type: clearOpened ? "START" : "SCAN_NOW",
    });
  } catch (_) {}
}

async function pingAttachedTab(cfg) {
  const tabId = await getAttachedTabId();
  if (!tabId) return 0;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab) {
      await chrome.storage.local.set({ attachedTabId: null, merchantTabs: 0 });
      return 0;
    }
    if (tab.status !== "complete") return 1;
    // Always try inject — don't wait for popup click
    await injectAndStart(tabId, { clearOpened: false });
    return 1;
  } catch (_) {
    await chrome.storage.local.set({ attachedTabId: null, merchantTabs: 0 });
    return 0;
  }
}

async function attachToTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const url = tab.url || "";
  if (!/https:\/\/([a-z0-9.-]+\.)?paytm\.com\//i.test(url)) {
    throw new Error("Attach sirf Paytm Transactions tab pe — gpzes History se confirm nahi hota");
  }
  if (tab.status !== "complete") {
    throw new Error("Page load hone do — phir Attach");
  }

  await enablePersistentWatch();
  await chrome.storage.local.set({
    attachedTabId: tabId,
    merchantTabs: 1,
    attachedAt: Date.now(),
    keepAttached: true,
  });
  await injectAndStart(tabId, { clearOpened: true });
  await setBadge("ON", "#16a34a");
  const after = await chrome.tabs.get(tabId);
  return { tabId, url: after.url || url };
}

async function gotoTransactions(url, { soft = false } = {}) {
  const tabId = await getAttachedTabId();
  if (!tabId) return { ok: false, error: "not attached" };
  const target = url || "https://dashboard.paytm.com/next/transactions";
  const now = Date.now();
  if (reloadInFlight || now - lastReloadAt < 9000) {
    return { ok: false, error: "reload cooldown" };
  }
  reloadInFlight = true;
  lastReloadAt = now;
  try {
    const tab = await chrome.tabs.get(tabId);
    const cur = tab.url || "";
    const onTxn = /\/next\/transactions/i.test(cur) && !/invoice/i.test(cur);
    if (soft || onTxn) {
      // Soft: reload same transactions page (no invoice URL reopen)
      await chrome.tabs.reload(tabId, { bypassCache: true });
    } else {
      // Off-list / invoice → navigate to transactions (no ?_gw spam)
      await chrome.tabs.update(tabId, { url: target });
    }
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 25000);
      const listener = async (id, info) => {
        if (id !== tabId || info.status !== "complete") return;
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        try {
          await new Promise((r) => setTimeout(r, 2000));
          await injectAndStart(tabId, { clearOpened: false });
        } catch (_) {}
        resolve();
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
    await chrome.storage.local.set({ lastHardRefreshAt: Date.now() });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  } finally {
    reloadInFlight = false;
  }
}

/** Hard reload → also force transactions URL (legacy name). */
async function reloadAttachedTab() {
  return gotoTransactions("https://dashboard.paytm.com/next/transactions");
}

async function tick() {
  const cfg = await getConfig();
  if (!cfg.enabled) {
    await setBadge("OFF", "#64748b");
    return;
  }
  try {
    await heartbeat(cfg);
    const pending = await fetchPending(cfg);
    const history = await fetchWatchHistory(cfg).catch(() => []);
    const tabs = await pingAttachedTab(cfg);
    await chrome.storage.local.set({
      pendingPayments: pending,
      pendingCount: pending.length,
      watchHistory: history,
      lastPollAt: new Date().toISOString(),
      merchantTabs: tabs,
      lastError: "",
    });
    if (pending.length) await setBadge(String(pending.length), "#6726A8");
    else await setBadge(tabs ? "ON" : "…", "#16a34a");
  } catch (e) {
    await setBadge("!", "#dc2626");
    await chrome.storage.local.set({ lastError: String(e.message || e) });
  }
}

function scheduleAlarms(_cfg) {
  chrome.alarms.create("verifyTick", { periodInMinutes: 1 });
  // Chain short wakes — Chrome clamps, but still helps keep SW from staying dead forever
  chrome.alarms.create("pulse", { delayInMinutes: 0.5 });
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "verifyTick" || a.name === "pulse" || a.name === "keepAlive") {
    tick();
    chrome.alarms.create("pulse", { delayInMinutes: 0.5 });
  }
});

// Paytm reload/nav ke baad auto re-inject — full-time watch
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== "complete") return;
  try {
    const attached = await getAttachedTabId();
    if (!attached || attached !== tabId) return;
    const cfg = await getConfig();
    if (!cfg.enabled) return;
    await new Promise((r) => setTimeout(r, 1500));
    await injectAndStart(tabId, { clearOpened: false });
  } catch (_) {}
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const attached = await getAttachedTabId();
  if (attached === tabId) {
    await chrome.storage.local.set({ attachedTabId: null, merchantTabs: 0 });
    await setBadge("…", "#64748b");
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "PAYMENT_OUTCOME") {
    (async () => {
      const cfg = await getConfig();
      if (!cfg.enabled) {
        sendResponse({ ok: false, error: "Verifier OFF" });
        return;
      }
      if (!cfg.autoApprove) {
        sendResponse({ ok: false, error: "Auto-approve OFF — Manual SUCCESS use karo" });
        return;
      }
      const outcome = msg.outcome || {};
      const key = [
        outcome.status,
        outcome.gateway_payment_id || "",
        outcome.track_code || "",
        outcome.provider_transaction_ref || "",
        outcome.amount || 0,
      ].join("|");
      if (processedKeys.has(key)) {
        sendResponse({ ok: true, message: "already processed" });
        return;
      }
      try {
        const result = await postVerification(outcome, cfg);
        if (result.ok) processedKeys.add(key);
        sendResponse(result);
      } catch (e) {
        sendResponse({ ok: false, error: String(e.message || e) });
      }
    })();
    return true;
  }

  if (msg.type === "MANUAL_SUBMIT") {
    (async () => {
      sendResponse(await postVerification(msg.outcome, await getConfig()));
    })();
    return true;
  }

  if (msg.type === "ATTACH_ACTIVE_TAB") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) {
          sendResponse({ ok: false, error: "No active tab" });
          return;
        }
        const info = await attachToTab(tab.id);
        sendResponse({ ok: true, ...info });
        tick();
      } catch (e) {
        sendResponse({ ok: false, error: String(e.message || e) });
      }
    })();
    return true;
  }

  if (msg.type === "FETCH_PENDING") {
    (async () => {
      try {
        const cfg = await getConfig();
        const payments = await fetchPending(cfg);
        const history = await fetchWatchHistory(cfg).catch(() => []);
        await chrome.storage.local.set({
          pendingPayments: payments,
          pendingCount: payments.length,
          watchHistory: history,
          lastPollAt: new Date().toISOString(),
          lastError: "",
        });
        if (payments.length) await setBadge(String(payments.length), "#6726A8");
        sendResponse({ ok: true, payments, history });
      } catch (e) {
        sendResponse({ ok: false, error: String(e.message || e), payments: [], history: [] });
      }
    })();
    return true;
  }

  if (msg.type === "KEEP_ALIVE") {
    // Content watchdog — wake SW + ensure attached tab still watched
    (async () => {
      try {
        chrome.alarms.create("pulse", { delayInMinutes: 0.5 });
        await tick();
      } catch (_) {}
      sendResponse({ ok: true, at: Date.now() });
    })();
    return true;
  }

  if (msg.type === "FORCE_TICK") {
    tick().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === "GOTO_TRANSACTIONS") {
    gotoTransactions(msg.url, { soft: !!msg.soft }).then(sendResponse);
    return true;
  }

  if (msg.type === "RELOAD_ATTACHED_TAB") {
    reloadAttachedTab().then(sendResponse);
    return true;
  }

  if (msg.type === "DETACH") {
    (async () => {
      await disablePersistentWatch();
      await chrome.storage.local.set({ attachedTabId: null, merchantTabs: 0, keepAttached: false });
      await setBadge("…", "#64748b");
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg.type === "GET_PENDING") {
    chrome.storage.local
      .get([
        "pendingPayments",
        "pendingCount",
        "watchHistory",
        "lastPollAt",
        "merchantTabs",
        "lastError",
        "eventLog",
        "attachedTabId",
        "attachedAt",
      ])
      .then(sendResponse);
    return true;
  }

  if (msg.type === "CONFIG_UPDATED") {
    getConfig().then((cfg) => {
      scheduleAlarms(cfg);
      tick();
      sendResponse({ ok: true });
    });
    return true;
  }
});

chrome.runtime.onInstalled.addListener(async (details) => {
  const cur = await chrome.storage.sync.get(DEFAULTS);
  const patch = {};
  // Force production URL if missing / localhost (common reason extension "fetches nothing")
  if (!cur.gatewayUrl || /127\.0\.0\.1|localhost/i.test(String(cur.gatewayUrl))) {
    patch.gatewayUrl = DEFAULTS.gatewayUrl;
  }
  if (!cur.agentCode || cur.agentCode === "EXT_WATCHER_01") {
    patch.agentCode = DEFAULTS.agentCode;
    patch.agentSecret = DEFAULTS.agentSecret;
  }
  if (details.reason === "install") {
    Object.assign(patch, {
      ...DEFAULTS,
      autoRefresh: false,
      openDetails: false,
    });
    await chrome.storage.local.set({ attachedTabId: null, merchantTabs: 0, keepAttached: false });
    await setBadge("…", "#64748b");
  }
  if (Object.keys(patch).length) await chrome.storage.sync.set(patch);
  // On update/reload: KEEP attach — otherwise extension "stops working"
  scheduleAlarms(await getConfig());
  const { keepAttached } = await chrome.storage.local.get({ keepAttached: false });
  if (keepAttached) await enablePersistentWatch();
  tick();
});

chrome.runtime.onStartup.addListener(async () => {
  scheduleAlarms(await getConfig());
  const { keepAttached } = await chrome.storage.local.get({ keepAttached: false });
  if (keepAttached) await enablePersistentWatch();
  tick();
});

getConfig().then(async (cfg) => {
  scheduleAlarms(cfg);
  const { keepAttached } = await chrome.storage.local.get({ keepAttached: false });
  if (keepAttached) await enablePersistentWatch();
  tick();
});
