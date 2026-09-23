/** DMI Finance loan-recovery theme helpers (pay + caller create). */

export const DMI_BRAND = {
  navy: "#003B4A",
  teal: "#0D7377",
  mint: "#14A3A8",
  gold: "#C4A35A",
  ink: "#0F172A",
  paper: "#F3F6F8",
};

export function isLoanFinanceBrand(name?: string | null): boolean {
  const n = (name || "").toLowerCase();
  return n.includes("dmi") || n.includes("finance") || n.includes("loan");
}

export function loanPayCopy(merchantName?: string | null) {
  const loan = isLoanFinanceBrand(merchantName);
  if (!loan) {
    return {
      secureLabel: "256-bit Secured Checkout",
      payingLabel: "Paying to",
      appsTitle: "Pay with PhonePe or Paytm",
      qrTitle: "Scan QR with PhonePe or Paytm",
      qrHint: "PhonePe · Paytm",
      paidBtn: (amt: string) => `I have paid ${amt}`,
      waiting: (app?: string) =>
        app ? `Waiting for ${app} confirmation…` : "Waiting for payment confirmation…",
      waText: (amt: string, url: string, _name?: string) => `Please pay ${amt}: ${url}`,
      notice: "",
      footerLine: "Powered by Gateway · Do not refresh or close this page",
      trust: ["100% Secure Payments", "Encrypted UPI", "Verified merchant"],
      orderLabel: "Order ID",
      trackLabel: "UPI track note",
      vpaLabel: "Merchant UPI ID",
    };
  }
  return {
    secureLabel: "Bank-grade secured repayment",
    payingLabel: "Outstanding dues payable to",
    appsTitle: "Choose a UPI app to repay",
    qrTitle: "Scan QR to clear outstanding dues",
    qrHint: "PhonePe · Paytm · BHIM UPI compatible",
    paidBtn: (amt: string) => `Confirm dues paid · ${amt}`,
    waiting: (app?: string) =>
      app ? `Verifying ${app} repayment securely…` : "Verifying repayment securely…",
    waText: (amt: string, url: string, name?: string) =>
      `DMI Finance — Secure repayment link for outstanding loan / EMI of ${amt}.\n` +
      `Please pay only via this official link:\n${url}` +
      (name ? `\nCustomer / Loan ref: ${name}` : "") +
      `\n\nDo not share OTP or UPI PIN with anyone.`,
    notice:
      "This is an official collection link for unpaid loan / EMI. Pay only the amount shown. Never share OTP, UPI PIN or CVV.",
    footerLine: "DMI Finance · Secure UPI repayment desk · Session encrypted",
    trust: ["SSL Secured", "UPI Protected", "No card data stored", "Official collection"],
    orderLabel: "Reference ID",
    trackLabel: "Payment track code",
    vpaLabel: "Registered collection UPI",
  };
}
