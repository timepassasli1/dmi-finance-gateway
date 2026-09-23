# Gateway Payment Verifier (browser extension)

Yeh **customer pay page nahi** hai.

Yeh **merchant verification agent** hai:
- Paytm / PhonePe business me login rakho
- Extension background me pending payments dekhti hai
- Merchant panel pe credit/SUCCESS dikhte hi Gateway ko push karti hai

## Install (Chrome)

1. `chrome://extensions`
2. **Developer mode** ON
3. **Load unpacked** → select folder: `extension/`
4. Pin **Gateway Payment Verifier**

Agar pehle purani extension lagi ho → Remove → phir Load unpacked.

## Setup

Popup defaults:
- Gateway: `http://127.0.0.1:8080`
- Agent: `EXT_WATCHER_01`
- Secret: `ext_watcher_secret_change_me`

## Live flow

1. Dashboard se payment link banao → customer pay kare
2. Chrome me Paytm/PhonePe **business** login open rakho (transactions page)
3. Extension badge = pending count / `ON`
4. Merchant panel pe payment dikhte hi auto SUCCESS → live `/pay/PAY_...` page update

Manual backup: popup → Fallback PAY_ id → **Manual SUCCESS**

## Notes

- Customer checkout page alag rehti hai (`/pay/PAY_...`)
- Verifier hamesha merchant session pe chalni chahiye
- Production me official webhooks better hain; extension authorized ops ke liye hai
