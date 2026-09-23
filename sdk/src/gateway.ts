/**
 * Gateway UPI Payment SDK
 *
 * Browser-compatible JavaScript SDK for integrating the UPI Gateway.
 *
 * SECURITY RULES:
 * - Only use the PUBLIC key (pk_live_) in browser/frontend code.
 * - NEVER include secret keys (sk_live_) in browser JavaScript.
 * - NEVER trust this SDK's callbacks for final payment verification.
 * - Always verify payment server-to-server before fulfilling orders.
 */

export interface GatewayConfig {
  key: string;          // Public key: pk_live_xxx
  order_id: string;     // Gateway order ID from your server
  amount: number;       // Amount in paise
  currency?: string;
  customer?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  onSuccess?: (payment: PaymentResult) => void;
  onFailed?: (payment: PaymentResult) => void;
  onPending?: (payment: PaymentResult) => void;
  onClose?: () => void;
}

export interface PaymentResult {
  gateway_payment_id: string;
  status: string;
  amount: number;
  currency: string;
}

const GATEWAY_URL = (window as Window & { GATEWAY_URL?: string }).GATEWAY_URL || 'https://gateway.example.com';

class GatewaySDK {
  private iframe: HTMLIFrameElement | null = null;
  private overlay: HTMLDivElement | null = null;
  private config: GatewayConfig | null = null;
  private messageHandler: ((e: MessageEvent) => void) | null = null;

  pay(config: GatewayConfig): void {
    if (!config.key.startsWith('pk_live_') && !config.key.startsWith('pk_test_')) {
      console.error('[Gateway] Invalid key. Use pk_live_ (public key) only. Never use sk_live_ in browser.');
      return;
    }

    this.config = config;
    this.createPaymentUI();
  }

  private createPaymentUI(): void {
    if (!this.config) return;

    // Overlay
    this.overlay = document.createElement('div');
    Object.assign(this.overlay.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      background: 'rgba(0,0,0,0.6)',
      zIndex: '99999',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    });

    // Build payment URL with public key for UI (no secrets)
    const params = new URLSearchParams({
      key: this.config.key,
      order_id: this.config.order_id,
      amount: String(this.config.amount),
      currency: this.config.currency || 'INR',
      ...(this.config.customer?.name && { customer_name: this.config.customer.name }),
      ...(this.config.customer?.email && { customer_email: this.config.customer.email }),
      ...(this.config.customer?.phone && { customer_phone: this.config.customer.phone }),
    });

    // Payment iframe
    this.iframe = document.createElement('iframe');
    Object.assign(this.iframe.style, {
      width: '420px',
      height: '600px',
      maxWidth: '95vw',
      maxHeight: '90vh',
      border: 'none',
      borderRadius: '16px',
      background: '#fff',
    });
    this.iframe.src = `${GATEWAY_URL}/pay/${this.config.order_id}?${params}`;
    this.iframe.allow = 'payment';

    // Close on overlay click
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });

    this.overlay.appendChild(this.iframe);
    document.body.appendChild(this.overlay);

    // Listen for messages from payment page
    this.messageHandler = (event: MessageEvent) => {
      if (event.origin !== new URL(GATEWAY_URL).origin) return;
      this.handleMessage(event.data);
    };
    window.addEventListener('message', this.messageHandler);
  }

  private handleMessage(data: { type: string; payment: PaymentResult }): void {
    if (!this.config) return;

    switch (data.type) {
      case 'payment.success':
        this.config.onSuccess?.(data.payment);
        this.close();
        break;
      case 'payment.failed':
        this.config.onFailed?.(data.payment);
        this.close();
        break;
      case 'payment.pending':
        this.config.onPending?.(data.payment);
        break;
      case 'payment.close':
        this.close();
        break;
    }
  }

  close(): void {
    if (this.overlay) {
      document.body.removeChild(this.overlay);
      this.overlay = null;
      this.iframe = null;
    }
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler);
      this.messageHandler = null;
    }
    this.config?.onClose?.();
    this.config = null;
  }
}

// Singleton
export const Gateway = new GatewaySDK();

// UMD export for browser script tag usage
if (typeof window !== 'undefined') {
  (window as Window & { Gateway?: GatewaySDK }).Gateway = Gateway;
}
