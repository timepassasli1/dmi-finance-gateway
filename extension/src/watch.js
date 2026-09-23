// Gateway verifier v3.3 — Attach ke baad.
// Har scan pe live pending sync · multi-payment track match · refresh · details open.

(function () {
  const VERSION = "3.6.6";
  // Re-inject after extension reload must REPLACE old watcher (not early-return forever)
  if (window.__GATEWAY_VERIFIER_VERSION__ === VERSION) return;
  try {
    window.__GATEWAY_VERIFIER_API__?.stop?.();
  } catch (_) {}
  window.__GATEWAY_VERIFIER_VERSION__ = VERSION;

  function isPaytmHost() {
    const host = String(location.hostname || "").toLowerCase();
    return host.includes("paytm.com");
  }
  function transactionsUrl() {
    const host = String(location.hostname || "").toLowerCase();
    if (host.includes("business.paytm.com")) {
      return "https://business.paytm.com/transactions";
    }
    return "https://dashboard.paytm.com/next/transactions";
  }
  const TRANSACTIONS_URL = transactionsUrl();
  /** Safe detail open: only amount cell / row — never <a>/download/invoice */
  const OPEN_TXN_DETAILS = true;
  const pushed = new Set();
  /** Session-only: same row ek baar open. Attach pe clear. Storage me NAHI (warna sab block). */
  const openedRowKeys = new Set();
  const resolvedPayIds = new Set();
  const resolvedTracks = new Set();
  let watchlist = [];
  let started = false;
  let scanning = false;
  let inspecting = false;
  let scanTimer = null;
  let refreshTimer = null;
  let watchdogTimer = null;
  let lastSoftRefresh = 0;
  let lastHardReloadAsk = 0;
  let lastHud = "";
  let lastScanAt = 0;
  let scanStartedAt = 0;
  let refreshAttempt = 0;
  let agentCfg = {
    gatewayUrl: "https://gpzes.com/gw",
    agentCode: "AGENT_VIVEK",
    agentSecret: "YOUR_AGENT_SECRET",
  };

  const SCAN_MS = 2500;
  const REFRESH_MS = 10000;

  function rowKey(row) {
    return [
      row.amount || 0,
      (row.provider_transaction_ref || "").slice(0, 40),
      String(row.raw_snippet || "")
        .replace(/\s+/g, " ")
        .slice(0, 90),
    ].join("|");
  }

  function clearOpenedRows() {
    openedRowKeys.clear();
    chrome.storage.local.set({ openedRowKeys: [] });
  }

  function loadResolved() {
    chrome.storage.local.get({ resolvedPayIds: [], resolvedTracks: [] }, (data) => {
      for (const id of data.resolvedPayIds || []) resolvedPayIds.add(id);
      for (const t of data.resolvedTracks || []) resolvedTracks.add(String(t).toUpperCase());
    });
  }

  function rememberResolved(payId, track) {
    if (payId) {
      resolvedPayIds.add(payId);
      chrome.storage.local.get({ resolvedPayIds: [] }, (data) => {
        const arr = [...new Set([...(data.resolvedPayIds || []), payId])].slice(-100);
        chrome.storage.local.set({ resolvedPayIds: arr });
      });
    }
    if (track) {
      const t = String(track).toUpperCase();
      resolvedTracks.add(t);
      chrome.storage.local.get({ resolvedTracks: [] }, (data) => {
        const arr = [...new Set([...(data.resolvedTracks || []), t])].slice(-100);
        chrome.storage.local.set({ resolvedTracks: arr });
      });
    }
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function hud(msg, ok) {
    if (msg === lastHud && ok === undefined) return;
    lastHud = msg;
    let el = document.getElementById("gateway-verifier-hud");
    if (!el) {
      el = document.createElement("div");
      el.id = "gateway-verifier-hud";
      el.style.cssText =
        "position:fixed;z-index:2147483646;right:12px;bottom:12px;max-width:340px;padding:10px 12px;border-radius:12px;font:600 12px/1.35 system-ui,sans-serif;color:#fff;background:#121826;box-shadow:0 8px 20px rgba(0,0,0,.25);opacity:.94;pointer-events:none;white-space:pre-wrap;";
      document.documentElement.appendChild(el);
    }
    el.style.background = ok === true ? "#059669" : ok === false ? "#dc2626" : "#121826";
    el.textContent = msg;
  }

  function pageText(root) {
    try {
      const el = root || document.body || document.documentElement;
      return (el?.innerText || el?.textContent || "").slice(0, 80000);
    } catch (_) {
      return "";
    }
  }

  function extractTrack(text) {
    const m = String(text || "")
      .toUpperCase()
      .match(/\b(GW[A-F0-9]{8})\b/);
    return m ? m[1] : null;
  }

  function extractAllTracks(text) {
    const up = String(text || "").toUpperCase();
    const out = new Set();
    const re = /\b(GW[A-F0-9]{8})\b/g;
    let m;
    while ((m = re.exec(up))) out.add(m[1]);
    return [...out];
  }

  function extractPayId(text) {
    const m = String(text || "").match(/\b(PAY_[A-Za-z0-9]+)\b/);
    return m ? m[1] : null;
  }

  function extractTxnRef(text) {
    const m =
      String(text).match(/\bUTR[:\s#-]*([A-Za-z0-9]{8,})\b/i) ||
      String(text).match(/\bRRN[:\s#-]*([A-Za-z0-9]{8,})\b/i) ||
      String(text).match(/\b(UPI[A-Za-z0-9]{8,})\b/i) ||
      String(text).match(/\b([0-9]{12,22})\b/);
    return m ? m[1].replace(/\s+/g, "") : null;
  }

  function parseRupeeToPaise(text) {
    if (!text) return 0;
    const patterns = [
      /\u20B9\s*([\d,]+(?:\.\d{1,2})?)/,
      /Rs\.?\s*([\d,]+(?:\.\d{1,2})?)/i,
      /INR\s*([\d,]+(?:\.\d{1,2})?)/i,
      /(?:^|[^\d])([\d,]+(?:\.\d{2}))(?:\s|$)/,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (!m) continue;
      const rupees = Number(m[1].replace(/,/g, ""));
      if (!Number.isNaN(rupees) && rupees > 0 && rupees < 1000000) {
        return Math.round(rupees * 100);
      }
    }
    return 0;
  }

  function hashText(s) {
    let h = 0;
    for (let i = 0; i < Math.min(s.length, 100); i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h.toString(16);
  }

  function fingerprint(amount, snippet) {
    return `${amount}|${String(snippet || "").replace(/\s+/g, " ").slice(0, 80)}`;
  }

  function fmtAmt(paise) {
    return `\u20B9${(Number(paise) / 100).toFixed(2)}`;
  }

  function watchSummary() {
    const active = watchlist.filter((p) => !resolvedPayIds.has(p.gateway_payment_id));
    if (!active.length) return "No pending";
    return active
      .slice(0, 4)
      .map((p) => {
        const t = p.track_code || p.upi_note || "";
        const w = p.watched || p.last_watched_at ? "●" : "○";
        return `${w} ${fmtAmt(p.amount)} ${t}`;
      })
      .join("\n");
  }

  function pendingByAmount(amount) {
    return watchlist.filter(
      (p) => !resolvedPayIds.has(p.gateway_payment_id) && Number(p.amount) === Number(amount)
    );
  }

  function findPendingByTrack(track) {
    if (!track) return null;
    const t = String(track).toUpperCase();
    return (
      watchlist.find(
        (p) =>
          !resolvedPayIds.has(p.gateway_payment_id) &&
          (String(p.track_code || "").toUpperCase() === t ||
            String(p.upi_note || "").toUpperCase() === t)
      ) || null
    );
  }

  function loadAgentCfg() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(
        {
          gatewayUrl: "https://gpzes.com/gw",
          agentCode: "AGENT_VIVEK",
          agentSecret: "YOUR_AGENT_SECRET",
        },
        (data) => {
          agentCfg = { ...agentCfg, ...data };
          resolve(agentCfg);
        }
      );
    });
  }

  /** Direct fetch — SW sleep pe bhi pending sync chalta rahe */
  async function syncWatchlist() {
    try {
      await loadAgentCfg();
      const base = String(agentCfg.gatewayUrl || "https://gpzes.com/gw").replace(/\/$/, "");
      const res = await fetch(`${base}/v1/agents/pending-payments`, {
        headers: {
          "X-Agent-Code": agentCfg.agentCode || "AGENT_VIVEK",
          "X-Agent-Secret": agentCfg.agentSecret || "YOUR_AGENT_SECRET",
        },
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.payments)) watchlist = data.payments;
        return watchlist;
      }
    } catch (_) {}
    // Fallback: wake service worker
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "FETCH_PENDING" }, (resp) => {
          if (chrome.runtime.lastError) {
            resolve(watchlist);
            return;
          }
          if (resp?.ok && Array.isArray(resp.payments)) watchlist = resp.payments;
          resolve(watchlist);
        });
      } catch (_) {
        resolve(watchlist);
      }
    });
  }

  function push(outcome) {
    if (!outcome?.status) return;
    // Best flow: confirm only from Paytm, only with GW / PAY_ — never History page / amount.
    if (!isPaytmHost()) return;
    const track = String(outcome.track_code || extractTrack(outcome.remarks || "") || "").toUpperCase();
    const payId = outcome.gateway_payment_id || extractPayId(outcome.remarks || "") || "";
    if (!track && !payId) return;
    if (track) outcome.track_code = track;
    if (outcome.gateway_payment_id && resolvedPayIds.has(outcome.gateway_payment_id)) return;
    if (outcome.track_code && resolvedTracks.has(String(outcome.track_code).toUpperCase())) return;

    const key = [
      outcome.status,
      outcome.gateway_payment_id || "",
      outcome.track_code || "",
      outcome.provider_transaction_ref || "",
      outcome.amount || 0,
    ].join("|");
    if (pushed.has(key)) return;
    pushed.add(key);

    chrome.runtime.sendMessage({ type: "PAYMENT_OUTCOME", outcome }, (resp) => {
      if (chrome.runtime.lastError) {
        pushed.delete(key);
        return;
      }
      if (resp?.ok) {
        const id = resp.data?.gateway_payment_id || outcome.gateway_payment_id;
        rememberResolved(id, outcome.track_code);
        hud(`AUTO OK → ${id || "SUCCESS"}\n${watchSummary()}`, true);
        lastHud = "";
      } else {
        pushed.delete(key);
      }
    });
  }

  function looksLikeInvoice(el, text) {
    const blob = `${text || ""} ${el?.getAttribute?.("href") || ""} ${el?.getAttribute?.("aria-label") || ""} ${el?.className || ""}`.toLowerCase();
    return /invoice|invoices|gst\s*invoice|tax\s*invoice|download\s*invoice|view\s*invoice|\.pdf|eway|e-?way|receipt\s*pdf|generate\s*invoice/.test(
      blob
    );
  }

  function isOnInvoicePage() {
    const href = String(location.href || "").toLowerCase();
    const title = String(document.title || "").toLowerCase();
    const bodyHint = pageText().slice(0, 1500).toLowerCase();
    if (/invoice/.test(href) || /invoice/.test(title)) return true;
    // Invoice screens usually lack txn list but show invoice chrome
    if (/tax invoice|gstin|invoice no|invoice number|download pdf/.test(bodyHint) && !/transactions?/.test(href)) {
      return true;
    }
    return false;
  }

  async function escapeInvoiceIfNeeded() {
    if (!isOnInvoicePage() && !/invoice|download/i.test(location.href)) return false;
    hud("Invoice page → transactions…");
    lastHud = "";
    try {
      // Never click random Back — go straight to transactions list
      if (!location.href.startsWith(TRANSACTIONS_URL)) {
        location.assign(TRANSACTIONS_URL);
        await sleep(800);
        return true;
      }
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true })
      );
    } catch (_) {}
    return true;
  }

  function buildRow(el) {
    const text = (el.innerText || "").replace(/\s+/g, " ").trim();
    if (text.length < 4 || text.length > 1000) return null;
    if (looksLikeInvoice(el, text)) return null;
    // Skip pure nav / menu items
    if (/^(home|dashboard|settings|profile|logout|help|invoices?)$/i.test(text)) return null;
    const amount = parseRupeeToPaise(text);
    if (!amount) return null;
    let status = "SUCCESS";
    if (/failed|declined|rejected|refunded|failure/i.test(text)) status = "FAILED";
    return {
      el,
      status,
      amount,
      track_code: extractTrack(text) || "",
      gateway_payment_id: extractPayId(text) || "",
      provider_transaction_ref: extractTxnRef(text) || `ROW_${amount}_${hashText(text)}`,
      raw_snippet: text.slice(0, 220),
      remarks: text.slice(0, 400),
    };
  }

  function extractRows() {
    const seen = new Set();
    const out = [];
    // Prefer real table/txn rows — avoid broad `li` / invoice lists
    const selectors = [
      "table tbody tr",
      "[role='row']",
      "[class*='transaction']",
      "[class*='Transaction']",
      "[class*='txn']",
      "[class*='Txn']",
      "[data-testid*='transaction']",
      "[data-testid*='txn']",
      "tr",
    ];
    const nodes = [];
    for (const sel of selectors) {
      try {
        nodes.push(...document.querySelectorAll(sel));
      } catch (_) {}
      if (nodes.length > 200) break;
    }
    for (const row of nodes.slice(0, 200)) {
      if (looksLikeInvoice(row, row.innerText || "")) continue;
      // Skip rows that primarily contain invoice action links
      let invLink = null;
      try {
        invLink = row.querySelector?.(
          'a[href*="invoice"], a[href*="Invoice"], button[aria-label*="invoice"], button[aria-label*="Invoice"], [class*="invoice"], [class*="Invoice"]'
        );
      } catch (_) {}
      if (invLink) {
        // Still allow if row clearly looks like a payment credit line
        const t = (row.innerText || "").toLowerCase();
        if (/invoice/.test(t) && !/upi|credited|received|payment/.test(t)) continue;
      }
      const outcome = buildRow(row);
      if (!outcome) continue;
      const key = fingerprint(outcome.amount, outcome.raw_snippet);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(outcome);
    }
    return out.slice(0, 40);
  }

  function scrapeOpenDetails() {
    const roots = [
      ...document.querySelectorAll(
        '[role="dialog"], [class*="drawer"], [class*="Drawer"], [class*="modal"], [class*="Modal"], [class*="detail"], [class*="Detail"], aside, [class*="side"], [class*="Side"], [class*="panel"], [class*="Panel"]'
      ),
    ];
    let best = "";
    for (const r of roots) {
      const t = pageText(r);
      if (t.length > 30 && t.length < 30000 && t.length >= best.length) best = t;
    }
    if (best.length < 40) best = pageText();
    return {
      track_code: extractTrack(best) || "",
      tracks: extractAllTracks(best),
      gateway_payment_id: extractPayId(best) || "",
      remarks: best.slice(0, 1000),
      raw_snippet: best.slice(0, 400),
      amount: parseRupeeToPaise(best),
    };
  }

  async function closeDetails() {
    try {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true })
      );
      const btn = [...document.querySelectorAll("button, [role='button'], a, span")].find((b) => {
        const label = `${b.getAttribute("aria-label") || ""} ${b.textContent || ""}`.trim();
        return /^(close|back|×|✕|dismiss)$/i.test(label) || /close|dismiss|back to/i.test(label);
      });
      btn?.click();
    } catch (_) {}
    await sleep(300);
  }

  function clickableTarget(el) {
    if (!el) return null;
    const row = el.closest?.(
      "tr, [role='row'], [class*='txn'], [class*='Txn'], [class*='transaction'], [class*='Transaction']"
    );
    if (!row || looksLikeInvoice(row, row.innerText || "")) return null;
    // Prefer amount / credited text node — never links/buttons (invoice trap)
    const safe = [...row.querySelectorAll("td, div, span, p")].find((n) => {
      if (n.closest("a, button, [role='button']")) return false;
      const t = (n.innerText || "").trim();
      if (!t || t.length > 40) return false;
      return /₹|rs\.?|inr|\d+\.\d{2}/i.test(t) && !/invoice|download|pdf/i.test(t);
    });
    return safe || row;
  }

  async function openAndScrape(row) {
    if (!row?.el || inspecting) return { row, opened: false };
    const key = rowKey(row);
    if (openedRowKeys.has(key)) return { row, opened: false };
    if (looksLikeInvoice(row.el, row.raw_snippet || "")) {
      openedRowKeys.add(key);
      return { row, opened: false };
    }
    inspecting = true;
    let scrapedOk = false;
    try {
      if (await escapeInvoiceIfNeeded()) {
        return { row, opened: false };
      }
      hud(`Opening txn details · ${fmtAmt(row.amount)}…\n${watchSummary()}`);
      lastHud = "";
      const target = clickableTarget(row.el);
      if (!target) {
        return { row, opened: false };
      }
      target.scrollIntoView({ block: "center", behavior: "auto" });
      await sleep(200);
      // Click ONLY the row — do not click inner <a>/buttons (invoice trap)
      try {
        target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
        target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
        target.click();
      } catch (_) {
        try {
          target.click();
        } catch (_) {}
      }
      await sleep(1400);

      if (isOnInvoicePage() || looksLikeInvoice(document.body, pageText().slice(0, 800))) {
        openedRowKeys.add(key); // never retry this row
        await escapeInvoiceIfNeeded();
        await closeDetails();
        return { row, opened: false };
      }

      const detail = scrapeOpenDetails();
      // Reject invoice-looking panels
      if (looksLikeInvoice(null, detail.remarks || "")) {
        openedRowKeys.add(key);
        await closeDetails();
        await escapeInvoiceIfNeeded();
        return { row, opened: false };
      }
      scrapedOk = !!(detail.remarks && detail.remarks.length > 40);
      if (detail.track_code) row.track_code = detail.track_code;
      if (detail.gateway_payment_id) row.gateway_payment_id = detail.gateway_payment_id;
      row.remarks = detail.remarks || row.remarks;
      row.raw_snippet = detail.raw_snippet || row.raw_snippet;
      row._tracks = detail.tracks || [];
      if (scrapedOk || row.track_code) {
        openedRowKeys.add(key);
      }
      await closeDetails();
    } catch (_) {
      /* ignore — don't lock row, retry next scan */
    } finally {
      inspecting = false;
    }
    return { row, opened: scrapedOk || !!row.track_code };
  }

  function tryApproveFromText(text) {
    if (!isPaytmHost()) return 0;
    const tracks = extractAllTracks(text);
    let found = 0;
    for (const track of tracks) {
      const p = findPendingByTrack(track);
      // Push even if not in local pending — server matches GW + agent scope
      // (covers timeout window and slow Paytm refresh).
      push({
        status: "SUCCESS",
        amount: p?.amount || 0,
        currency: "INR",
        gateway_payment_id: p?.gateway_payment_id || "",
        track_code: track,
        provider_transaction_ref: `NOTE_${track}_${Date.now()}`,
        provider: "paytm",
        remarks: String(text).slice(0, 500),
        source: "extension-track-note",
      });
      found++;
    }
    return found;
  }

  /** Batch: saare GW tracks page/API text se ek saath approve */
  function harvestAllTracks(extraText) {
    const blob = [pageText(), extraText || "", window.__GW_LAST_API__ || ""].join("\n");
    return tryApproveFromText(blob);
  }

  // Listen for MAIN-world Paytm API harvest (GW notes in JSON)
  window.addEventListener("message", (ev) => {
    try {
      if (!isPaytmHost()) return;
      if (ev.source !== window) return;
      const d = ev.data;
      if (!d || d.source !== "GW_PAYTM_NET" || !d.text) return;
      try {
        window.__GW_LAST_API__ = String(d.text).slice(0, 400000);
      } catch (_) {}
      const n = tryApproveFromText(String(d.text));
      if (n > 0) {
        hud(`API batch · ${n} track(s)\n${watchSummary()}`, true);
        lastHud = "";
      }
    } catch (_) {}
  });

  /** Har 10s: transactions pe soft reload; warna / invoice pe → transactions URL. */
  function doAutoRefresh() {
    const now = Date.now();
    if (now - lastSoftRefresh < REFRESH_MS - 200) return false;
    if (inspecting) return false;
    lastSoftRefresh = now;
    lastHardReloadAsk = now;
    const onTxn = /\/next\/transactions/i.test(location.href) && !/invoice/i.test(location.href);
    hud(onTxn ? `Reload transactions…\n${watchSummary()}` : `Go → Transactions\n${watchSummary()}`);
    lastHud = "";
    try {
      chrome.runtime.sendMessage(
        { type: "GOTO_TRANSACTIONS", url: TRANSACTIONS_URL, soft: onTxn },
        (resp) => {
          if (chrome.runtime.lastError || !resp?.ok) {
            try {
              if (onTxn) location.reload();
              else location.assign(TRANSACTIONS_URL);
            } catch (_) {}
          }
        }
      );
    } catch (_) {
      try {
        if (onTxn) location.reload();
        else location.assign(TRANSACTIONS_URL);
      } catch (_) {}
    }
    return true;
  }

  function clickSoftRefresh() {
    return doAutoRefresh();
  }

  function askHardReload() {
    return doAutoRefresh();
  }

  async function scan() {
    if (!started) return;
    // Unstick if a previous scan hung
    if (scanning) {
      if (Date.now() - scanStartedAt < 25000) return;
      scanning = false;
      inspecting = false;
    }
    scanning = true;
    scanStartedAt = Date.now();
    try {
      await escapeInvoiceIfNeeded();
      await syncWatchlist();
      lastScanAt = Date.now();
      const active = watchlist.filter((p) => !resolvedPayIds.has(p.gateway_payment_id));
      const summary = watchSummary();

      if (!isPaytmHost()) {
        hud(`History ${active.length} pending\nPaytm Transactions pe Attach karo\n${summary}`);
        return;
      }

      const batchHits = harvestAllTracks();

      const rows = extractRows();
      // Confirm any visible GW even when pending list is empty (timeout / slow sync)
      for (const row of rows.slice(0, 40)) {
        if (!row.track_code) continue;
        const t = String(row.track_code).toUpperCase();
        if (resolvedTracks.has(t)) continue;
        const p = findPendingByTrack(row.track_code);
        push({
          status: "SUCCESS",
          amount: p?.amount || row.amount || 0,
          currency: "INR",
          gateway_payment_id: p?.gateway_payment_id || "",
          track_code: row.track_code,
          provider_transaction_ref: row.provider_transaction_ref,
          provider: "paytm",
          remarks: row.remarks,
          source: "extension-row-track",
        });
      }

      if (!active.length) {
        hud(`Idle · scanning GW · live\n(v${VERSION}) · tracks ${batchHits}`);
        return;
      }

      // Invoice page pe stuck ho to details open mat karo
      if (isOnInvoicePage()) {
        await escapeInvoiceIfNeeded();
        hud(`Invoice skip · back to list\n${summary}`);
        lastHud = "";
        return;
      }

      const interesting = rows.filter(
        (r) => r.track_code || pendingByAmount(r.amount).length > 0
      );

      hud(
        `LIVE · ${active.length} pending · rows ${interesting.length} · tracks ${batchHits}\n${summary}\nopened-skip ${openedRowKeys.size}`
      );
      lastHud = "";

      // Parallel list harvest: saari rows pe GW track → batch SUCCESS (no clicks)
      for (const row of interesting.slice(0, 40)) {
        if (!row.track_code) continue;
        const t = String(row.track_code).toUpperCase();
        if (resolvedTracks.has(t)) {
          openedRowKeys.add(rowKey(row));
          continue;
        }
        const p = findPendingByTrack(row.track_code);
        openedRowKeys.add(rowKey(row));
        push({
          status: "SUCCESS",
          amount: p?.amount || row.amount || 0,
          currency: "INR",
          gateway_payment_id: p?.gateway_payment_id || "",
          track_code: row.track_code,
          provider_transaction_ref: row.provider_transaction_ref,
          provider: "paytm",
          remarks: row.remarks,
          source: "extension-row-track",
        });
      }

      // Amount match intentionally absent — only GW track / PAY_ id

      if (!OPEN_TXN_DETAILS) {
        hud(`LIVE · track-only\n${summary}`);
        lastHud = "";
        return;
      }

      // Details when pending amount exists on list but GW note not visible yet
      let opened = 0;
      for (const row of interesting.slice(0, 15)) {
        if (opened >= 2) break;
        const key = rowKey(row);
        if (openedRowKeys.has(key)) continue;

        const matches = pendingByAmount(row.amount);
        if (!matches.length) continue;
        if (row.track_code && findPendingByTrack(row.track_code)) continue;

        const before = row.track_code;
        const { row: enriched, opened: didOpen } = await openAndScrape(row);
        if (didOpen) opened++;
        else {
          // click fail — thoda wait, next scan retry
          await sleep(300);
          continue;
        }

        const tracks = [
          enriched.track_code,
          ...(enriched._tracks || []),
          extractTrack(enriched.remarks || ""),
        ].filter(Boolean);

        let matched = false;
        for (const track of tracks) {
          if (resolvedTracks.has(String(track).toUpperCase())) continue;
          const p = findPendingByTrack(track);
          push({
            status: "SUCCESS",
            amount: p?.amount || enriched.amount || 0,
            currency: "INR",
            gateway_payment_id: p?.gateway_payment_id || "",
            track_code: track,
            provider_transaction_ref:
              enriched.provider_transaction_ref || `DET_${track}_${Date.now()}`,
            provider: "paytm",
            remarks: enriched.remarks,
            raw_snippet: enriched.raw_snippet,
            source: "extension-details-track",
          });
          matched = true;
          break;
        }

        // Never amount-fallback after details — track required
        if (!matched && !before) {
          // leave row unlocked if no track found so next scan can retry
        } else if (matched) {
          openedRowKeys.add(key);
        }
        await sleep(450);
      }

      if (!opened && interesting.length && interesting.every((r) => openedRowKeys.has(rowKey(r)))) {
        hud(`All matching rows already opened\nWait for NEW Paytm txn\n${summary}`);
        lastHud = "";
      }
    } catch (_) {
      /* never break Paytm */
    } finally {
      scanning = false;
    }
  }

  function stop() {
    started = false;
    if (scanTimer) clearInterval(scanTimer);
    if (refreshTimer) clearInterval(refreshTimer);
    if (watchdogTimer) clearInterval(watchdogTimer);
    scanTimer = null;
    refreshTimer = null;
    watchdogTimer = null;
    document.getElementById("gateway-verifier-hud")?.remove();
  }

  function ensureTimers() {
    if (!started) return;
    if (!scanTimer) scanTimer = setInterval(() => scan(), SCAN_MS);
    if (!refreshTimer) {
      refreshTimer = setInterval(() => {
        if (!started) return;
        doAutoRefresh();
      }, REFRESH_MS);
    }
    if (!watchdogTimer) {
      watchdogTimer = setInterval(() => {
        if (!started) return;
        // SW sleep / hung scan se bachao — force continue
        if (Date.now() - lastScanAt > 12000) {
          scanning = false;
          inspecting = false;
          scan();
        }
        if (Date.now() - lastSoftRefresh > 18000) {
          doAutoRefresh();
        }
        // Wake SW periodically
        try {
          chrome.runtime.sendMessage({ type: "KEEP_ALIVE" }, () => {
            void chrome.runtime.lastError;
          });
        } catch (_) {}
      }, 5000);
    }
  }

  function start(opts = {}) {
    const shouldClear = opts.clearOpened === true;
    if (shouldClear) clearOpenedRows();
    if (started) {
      ensureTimers();
      scan();
      return;
    }
    started = true;
    loadResolved();
    loadAgentCfg();
    hud(`Always-on v${VERSION}\nTrack-only · no amount match`);
    lastHud = "";
    lastScanAt = Date.now();
    setTimeout(() => scan(), 700);
    // First refresh after full 10s — not immediate (avoid invoice race)
    ensureTimers();
  }

  window.__GATEWAY_VERIFIER_API__ = { start, stop, version: VERSION, clearOpenedRows };

  if (typeof window.__GATEWAY_VERIFIER_ON_MSG__ === "function") {
    try {
      chrome.runtime.onMessage.removeListener(window.__GATEWAY_VERIFIER_ON_MSG__);
    } catch (_) {}
  }
  function onMsg(msg, _s, sendResponse) {
    try {
      if (msg.type === "PING") {
        sendResponse({
          ok: true,
          version: VERSION,
          pending: watchlist.length,
          opened: openedRowKeys.size,
        });
        return;
      }
      if (msg.type === "WATCHLIST") {
        watchlist = Array.isArray(msg.payments) ? msg.payments : [];
        hud(`Pending updated (${watchlist.length})\n${watchSummary()}`);
        lastHud = "";
        sendResponse({ ok: true, n: watchlist.length });
        return;
      }
      if (msg.type === "START") {
        start({ clearOpened: true });
        sendResponse({ ok: true, started, version: VERSION, pending: watchlist.length });
        return;
      }
      if (msg.type === "SCAN_NOW") {
        start({ clearOpened: false });
        scan();
        sendResponse({ ok: true, started, version: VERSION, pending: watchlist.length });
        return;
      }
      if (msg.type === "CLEAR_OPENED") {
        clearOpenedRows();
        sendResponse({ ok: true });
        return;
      }
      if (msg.type === "SOFT_REFRESH") {
        sendResponse({ ok: clickSoftRefresh() });
        return;
      }
      if (msg.type === "RESET_BASELINE") {
        sendResponse({ ok: true, opened: openedRowKeys.size });
        return;
      }
      if (msg.type === "STOP") {
        stop();
        sendResponse({ ok: true });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e.message || e) });
    }
  }
  window.__GATEWAY_VERIFIER_ON_MSG__ = onMsg;
  chrome.runtime.onMessage.addListener(onMsg);

  try {
    loadResolved();
    chrome.storage.local.get({ keepAttached: false, openedRowKeys: [] }, (data) => {
      chrome.storage.local.set({ openedRowKeys: [] });
      if (data.keepAttached && /paytm\.com/i.test(location.hostname || "")) {
        hud(`Auto-start ${VERSION}…`);
        setTimeout(() => {
          if (!started) start({ clearOpened: false });
          else ensureTimers();
        }, 600);
      } else {
        hud(`Ready ${VERSION} — Attach dabao`);
      }
    });
  } catch (_) {}
})();
