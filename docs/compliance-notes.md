# Compliance Notes

## Financial Compliance

- The internal wallet is an **accounting/ledger representation** — not a bank account or stored-value wallet
- This platform does **not** implement unauthorized custody, pooling, or movement of customer funds
- Actual settlement to merchant bank accounts must flow through an appropriately authorized payment aggregator/payment gateway
- The platform does not collect or pool customer funds

## Payment Verification Rules

- A frontend redirect alone **NEVER** marks a payment as SUCCESS
- A screenshot **NEVER** marks a payment as SUCCESS
- A customer-provided transaction ID **NEVER** independently marks a payment as SUCCESS
- Only an authorized payment provider confirmation through the Verification Engine can finalize a payment

## Verification Agent Rules

The verification agent MUST NOT implement:
- CAPTCHA bypass
- Anti-bot bypass
- Credential extraction
- Session-cookie extraction
- Stealth browser automation
- Unauthorized scraping
- Security-control bypass

The agent must ONLY consume data from an authorized source.

## Data Security

- Passwords: bcrypt (cost 12)
- API secret keys: bcrypt hash (never stored plaintext)
- Processing merchant credentials: AES-256-GCM encrypted
- Webhook secrets: AES-256-GCM encrypted
- JWT secrets: min 32 characters
- Audit log: immutable, append-only

## Never Log

- Passwords
- API secret keys (sk_live_)
- Private keys
- Session cookies
- Payment credentials
- Webhook secrets
