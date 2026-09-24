(function () {
  const cfg = window.DMI_CONFIG || {};
  // VPA always from config — never from URL (prevents hijack)
  const vpa = cfg.vpa || "finomer125532@finobank";
  const pn = cfg.merchantName || "DMI Finance";

  const params = new URLSearchParams(window.location.search);

  // External site can pass: am|amount, ref|order_id|oid, name|customer, tn|note
  const amRaw = params.get("am") || params.get("amount") || "";
  const ref = (
    params.get("ref") ||
    params.get("order_id") ||
    params.get("oid") ||
    ""
  ).trim();
  const customer = (params.get("name") || params.get("customer") || "").trim();
  const noteParam = (params.get("tn") || params.get("note") || "").trim();
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
  const bits = [];
  if (customer) bits.push(customer);
  if (ref) bits.push("Ref · " + ref);
  if (bits.length) {
    refLine.hidden = false;
    refLine.textContent = bits.join(" · ");
  }

  // UPI transaction note (shows in payer app)
  let tn = noteParam;
  if (!tn) {
    if (ref && customer) tn = customer + " — " + ref;
    else if (ref) tn = "Payment — " + ref;
    else if (customer) tn = "Payment — " + customer;
    else tn = pn + " outstanding";
  }
  // UPI tn length soft-limit
  if (tn.length > 50) tn = tn.slice(0, 50);

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

  const isAndroid = /android/i.test(navigator.userAgent || "");
  const phonepe = isAndroid ? "phonepe://upi/pay?" + q : "phonepe://upi//pay?" + q;

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

  document.getElementById("btnPhonepe").href = phonepe;
  document.getElementById("btnPaytm").href = paytm;
  const btnPrimary = document.getElementById("btnPrimary");
  btnPrimary.href = phonepe;
  btnPrimary.textContent = "Pay " + amountLabel + " securely with PhonePe";
  document.getElementById("btnOpenUpi").href = upiPay;

  const qrEl = document.getElementById("qr");
  qrEl.innerHTML = "";
  if (typeof QRCode === "function") {
    new QRCode(qrEl, {
      text: upiPay,
      width: 220,
      height: 220,
      colorDark: "#003B4A",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.M,
    });
  } else {
    const img = document.createElement("img");
    img.width = 220;
    img.height = 220;
    img.alt = "UPI payment QR";
    img.src =
      "https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=" +
      encodeURIComponent(upiPay);
    qrEl.appendChild(img);
  }

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
