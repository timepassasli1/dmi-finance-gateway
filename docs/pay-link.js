/**
 * Drop this on your OTHER site. Builds the DMI gateway pay link.
 * VPA stays on the gateway — never pass VPA from your site.
 *
 * Usage:
 *   const url = DMIPayLink({ amount: 1500, ref: "ORD-991", name: "Rahul" });
 *   window.location.href = url;
 *   // or: window.open(url, "_blank");
 */
(function (global) {
  var GATEWAY = "https://newplan87.github.io/dmi-finance-gateway/pay.html";

  function DMIPayLink(opts) {
    opts = opts || {};
    var amount = Number(String(opts.amount != null ? opts.amount : opts.am || "").replace(/,/g, ""));
    if (!amount || amount <= 0) throw new Error("Valid amount required");

    var u = new URL(GATEWAY);
    u.searchParams.set("am", amount.toFixed(2));
    if (opts.ref || opts.order_id) u.searchParams.set("ref", String(opts.ref || opts.order_id));
    if (opts.name || opts.customer) u.searchParams.set("name", String(opts.name || opts.customer));
    if (opts.tn || opts.note) u.searchParams.set("tn", String(opts.tn || opts.note));
    return u.toString();
  }

  global.DMIPayLink = DMIPayLink;
  global.DMI_GATEWAY_URL = GATEWAY;
})(typeof window !== "undefined" ? window : this);
