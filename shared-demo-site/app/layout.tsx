import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cosanum · Training live demo",
  description: "Gemeinsamer synthetischer Trainingsablauf auf zwei Geräten.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body className="antialiased">{children}</body>
    </html>
  );
}
