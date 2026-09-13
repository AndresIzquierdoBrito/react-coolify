import type { Metadata } from "next";
import { Rubik, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Providers } from "@/components/providers";

const rubik = Rubik({
  variable: "--font-rubik",
  subsets: ["latin"],
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://projects.izbri.com"),
  applicationName: "Izbri Projects",
  title: { default: "Izbri Projects", template: "%s · Izbri Projects" },
  description: "Live applications, case studies, and independently measured reliability by Izbri.",
  icons: {
    icon: [
      { url: "/izbri-projects-icon.svg", type: "image/svg+xml" },
      { url: "/izbri-projects-icon.png", type: "image/png" },
      { url: "/izbri-projects-icon.webp", type: "image/webp" },
    ],
    apple: [{ url: "/izbri-projects-icon.png", type: "image/png" }],
  },
  manifest: "/manifest.webmanifest",
  openGraph: {
    siteName: "Izbri Projects",
    type: "website",
    images: [
      {
        url: "/izbri-projects-icon.png",
        width: 1100,
        height: 1142,
        alt: "Izbri Projects",
      },
    ],
  },
  twitter: {
    card: "summary",
    images: ["/izbri-projects-icon.png"],
  },
};

const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem("theme");
    var theme = stored === "dark" || stored === "light" || stored === "system" ? stored : "system";
    var resolved = theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : theme === "system" ? "light" : theme;
    document.documentElement.setAttribute("data-theme", resolved);
    document.documentElement.style.colorScheme = resolved;
  } catch (_) {}
}());
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${rubik.variable} ${mono.variable}`}>
        <Providers>{children}</Providers>
        <Script id="theme-init" strategy="beforeInteractive">{themeInitScript}</Script>
      </body>
    </html>
  );
}
