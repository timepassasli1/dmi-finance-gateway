/** Browser-safe gateway URLs for integration examples. */
export function gatewayApiUrl(): string {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/gw`;
  }
  return process.env.NEXT_PUBLIC_GATEWAY_API_URL || "https://gpzes.com/gw";
}

export function gatewaySiteUrl(): string {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return process.env.NEXT_PUBLIC_SITE_URL || "https://gpzes.com";
}

export function payPageUrl(gatewayPaymentId: string): string {
  return `${gatewaySiteUrl()}/pay/${gatewayPaymentId}`;
}

export function shareCreateUrl(token: string): string {
  return `${gatewaySiteUrl()}/s/${token}`;
}
