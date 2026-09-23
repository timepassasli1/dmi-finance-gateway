import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, currency = "INR"): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount / 100);
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
}

export function statusColor(status: string): string {
  const colors: Record<string, string> = {
    SUCCESS: "bg-green-100 text-green-800",
    ACTIVE: "bg-green-100 text-green-800",
    APPROVED: "bg-green-100 text-green-800",
    FAILED: "bg-red-100 text-red-800",
    REJECTED: "bg-red-100 text-red-800",
    SUSPENDED: "bg-red-100 text-red-800",
    PENDING: "bg-yellow-100 text-yellow-800",
    PENDING_REVIEW: "bg-orange-100 text-orange-800",
    UNDER_REVIEW: "bg-blue-100 text-blue-800",
    CREATED: "bg-gray-100 text-gray-800",
    EXPIRED: "bg-gray-100 text-gray-800",
    REFUNDED: "bg-purple-100 text-purple-800",
    REFUND_PENDING: "bg-purple-100 text-purple-800",
  };
  return colors[status] || "bg-gray-100 text-gray-600";
}
