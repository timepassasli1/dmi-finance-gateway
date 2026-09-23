import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DMI Finance — Loan repayment",
  description: "Secure UPI payment for outstanding loan dues",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Fraunces:opsz,wght@9..144,600;9..144,700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-[#F3F6F8] antialiased" style={{ fontFamily: '"DM Sans", system-ui, sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
