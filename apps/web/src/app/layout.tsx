import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { ThemeProvider, THEME_INIT_SCRIPT } from "@/components/ui/ThemeProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Web Design OS",
  description: "Internal pipeline tool for running the web design business.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // THEME_INIT_SCRIPT sets data-theme/data-font on this element before
      // hydration (to avoid a flash of the wrong theme); tell React not to
      // treat that as a mismatch against its own server-rendered markup.
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        {/* Runs before hydration so theme/font apply on the very first
            paint — otherwise a dark-mode user would see a flash of the
            light theme (or vice versa) on every load. */}
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
