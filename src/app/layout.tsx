import type { Metadata } from "next";
import { Russo_One, Carme, Karla } from "next/font/google";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/session";
import "./globals.css";

const russoOne = Russo_One({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-russo",
});

const carme = Carme({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-carme",
});

const karla = Karla({
  subsets: ["latin"],
  variable: "--font-karla",
});

export const metadata: Metadata = {
  title: "TouchlineOS | Turn Your FC Save Into A Living Managerial Career",
  description: "A persistent football intelligence layer for your EA FC Career Mode.",
  icons: {
    icon: "/touchlineOS.png",
    shortcut: "/touchlineOS.png",
    apple: "/touchlineOS.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${russoOne.variable} ${carme.variable} ${karla.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Applies the persisted theme before first paint to avoid a light->dark flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className="bg-[var(--background)] text-[var(--foreground)] font-sans antialiased min-h-screen transition-colors selection:bg-[#FF8C7A] selection:text-white">
        {children}
      </body>
    </html>
  );
}