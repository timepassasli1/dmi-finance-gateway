(function () {
  const cfg = window.DMI_CONFIG || {};
  const vpa = cfg.vpa || "finomer125532@finobank";
  const pn = cfg.merchantName || "DMI Finance";

  const params = new URLSearchParams(window.location.search);
  const amRaw = params.get("am") || params.get("amount") || "";
  const ref = (params.get("ref") || params.get("note") || "").trim();
  const amount = Number(String(amRaw).replace(/,/g, ""));

  const payCard = document.getElementById("payCard");
  const errCard = document.getElementById("errCard");

  if (!amount || amount <= 0) {
    payCard.hidden = true;
    errCard.hidden = false;
    return;
  }

  const am = amount.toFixed(2);
  const amountLabel =
    "₹" + amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  document.getElementById("amountDisplay").textContent = amountLabel;
  document.getElementById("vpaText").textContent = vpa;
  document.getElementById("metaVpa").textContent = vpa;

  const refLine = document.getElementById("refLine");
  if (ref) {
    refLine.hidden = false;
    refLine.textContent = "Ref · " + ref;
  }

  const tn = ref ? "Loan dues — " + ref : "DMI Finance loan / EMI outstanding";
  const q =
    "pa=" +
    encodeURIComponent(vpa) +
    "&pn=" +
    encodeURIComponent(pn) +
    "&am=" +
    encodeURIComponent(am) +
    "&cu=INR&tn=" +
    encodeURIComponent(tn);
  const upiPay = "upi://pay?" + q;

  // PhonePe: try native-ish + fallback upi
  const isAndroid = /android/i.test(navigator.userAgent || "");
  let phonepe = upiPay;
  if (isAndroid) {
    // Generic PhonePe UPI intent
    phonepe = "phonepe://upi/pay?" + q;
  } else {
    phonepe = "phonepe://upi//pay?" + q;
  }

  const paytm =
    "paytmmp://cash_wallet?pa=" +
    encodeURIComponent(vpa) +
    "&pn=" +
    encodeURIComponent(pn) +
    "&am=" +
    encodeURIComponent(am) +
    "&cu=INR&tn=" +
    encodeURIComponent(tn) +
    "&featuretype=money_transfer";

  const btnPhonepe = document.getElementById("btnPhonepe");
  const btnPaytm = document.getElementById("btnPaytm");
  const btnPrimary = document.getElementById("btnPrimary");
  const btnOpenUpi = document.getElementById("btnOpenUpi");

  btnPhonepe.href = phonepe;
  btnPaytm.href = paytm;
  btnPrimary.href = phonepe;
  btnPrimary.textContent = "Pay " + amountLabel + " securely with PhonePe";
  btnOpenUpi.href = upiPay;

  // QR image (CDN QR library path was 404 — use public QR API)
  const qrImg = document.getElementById("qr");
  qrImg.src =
    "https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&ecc=M&data=" +
    encodeURIComponent(upiPay);
  qrImg.onerror = function () {
    // fallback mirror
    qrImg.src =
      "https://quickchart.io/qr?size=220&margin=2&text=" + encodeURIComponent(upiPay);
  };

  document.getElementById("copyVpa").addEventListener("click", async function () {
    try {
      await navigator.clipboard.writeText(vpa);
      this.textContent = "Copied";
      const btn = this;
      setTimeout(function () {
        btn.textContent = "Copy";
      }, 1200);
    } catch (_) {}
  });

  // tabs
  const panelUpi = document.getElementById("panelUpi");
  const panelQr = document.getElementById("panelQr");
  document.querySelectorAll(".tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      document.querySelectorAll(".tab").forEach(function (t) {
        t.classList.remove("active");
      });
      tab.classList.add("active");
      const which = tab.getAttribute("data-tab");
      panelUpi.hidden = which !== "upi";
      panelQr.hidden = which !== "qr";
    });
  });
})();
