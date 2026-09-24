(function () {
  const cfg = window.DMI_CONFIG || {};
  const form = document.getElementById("form");
  const amountEl = document.getElementById("amount");
  const refEl = document.getElementById("ref");
  const err = document.getElementById("err");
  const result = document.getElementById("result");
  const outUrl = document.getElementById("outUrl");
  const amtLabel = document.getElementById("amtLabel");
  const copyBtn = document.getElementById("copyBtn");
  const waBtn = document.getElementById("waBtn");
  const previewBtn = document.getElementById("previewBtn");

  function rupees(n) {
    return "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function buildPayUrl(am, ref) {
    const u = new URL("pay.html", window.location.href);
    u.searchParams.set("am", String(am));
    if (ref) u.searchParams.set("ref", ref);
    return u.toString();
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    err.hidden = true;
    const raw = String(amountEl.value || "").trim().replace(/,/g, "");
    const am = Number(raw);
    if (!am || am <= 0) {
      err.textContent = "Valid outstanding amount enter karo";
      err.hidden = false;
      return;
    }
    const ref = String(refEl.value || "").trim();
    const url = buildPayUrl(am.toFixed(2), ref);
    const label = rupees(am);
    amtLabel.textContent = label;
    outUrl.textContent = url;
    previewBtn.href = url;
    const wa =
      "DMI Finance — Secure repayment link for outstanding loan / EMI of " +
      label +
      ".\nPlease pay only via this official link:\n" +
      url +
      (ref ? "\nCustomer / Loan ref: " + ref : "") +
      "\n\nDo not share OTP or UPI PIN with anyone.";
    waBtn.href = "https://wa.me/?text=" + encodeURIComponent(wa);
    result.hidden = false;
    copyBtn.textContent = "Copy secure link";
  });

  copyBtn.addEventListener("click", async function () {
    try {
      await navigator.clipboard.writeText(outUrl.textContent);
      copyBtn.textContent = "Copied";
      setTimeout(function () {
        copyBtn.textContent = "Copy secure link";
      }, 1500);
    } catch (_) {
      copyBtn.textContent = "Copy failed";
    }
  });

  // brand touch
  document.documentElement.style.setProperty("--teal", cfg.brandColor || "#0D7377");
})();
