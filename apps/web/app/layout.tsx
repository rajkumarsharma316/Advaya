import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "./context/AuthContext";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Advaya — Encrypted Messenger",
  description: "End-to-end encrypted, decentralized messaging on Stellar. Your conversations, your keys.",
  keywords: ["encrypted messaging", "Stellar", "decentralized", "privacy", "secure chat"],
  openGraph: {
    title: "Advaya — Encrypted Messenger",
    description: "End-to-end encrypted, decentralized messaging on Stellar.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable} style={{ height: '100%' }}>
      <body style={{ height: '100%', overflow: 'hidden' }}>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
