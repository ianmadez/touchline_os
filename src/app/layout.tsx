import type { Metadata, Viewport } from "next";
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

/**
 * `viewport-fit=cover` is what lets the app paint under the notch and home indicator; without it
 * every `env(safe-area-inset-*)` reads as 0 and the bottom bar floats inside a letterbox.
 *
 * `interactive-widget=resizes-content` makes the software keyboard shrink the layout viewport on
 * Android Chrome, so the debrief forms and the dialog scroll areas react to it the same way they do
 * on iOS. Zoom is left alone on purpose: the 16px input floor in `globals.css` fixes the cause.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
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
        {/* The bar takes its colour from the app's own theme toggle, not the OS preference, so it
            starts light and the bootstrap script corrects it before the first paint. */}
        <meta name="theme-color" content="#f8fafc" />
        {/* Applies the persisted theme before first paint to avoid a light->dark flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className="bg-[var(--background)] text-[var(--foreground)] font-sans antialiased min-h-dvh transition-colors selection:bg-[#FF8C7A] selection:text-white">
        {children}
      </body>
    </html>
  );
}