import type { Metadata, Viewport } from "next";
import { Nav } from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "The Brief — just the news", template: "%s — The Brief" },
  description: "Worldwide news from the countries and topics you choose, in a few sentences. No account, no ads.",
  applicationName: "The Brief",
  referrer: "strict-origin-when-cross-origin",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FAF9F6" },
    { media: "(prefers-color-scheme: dark)", color: "#121211" },
  ],
};

// Applies the saved theme and text size before first paint (no flash).
const bootScript = `try{var p=JSON.parse(localStorage.getItem("brief.prefs.v1")||"{}");var d=document.documentElement;if(p.theme&&p.theme!=="system")d.dataset.theme=p.theme;if(p.textSize)d.dataset.size=p.textSize;}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: bootScript }} />
      </head>
      <body>
        <a className="skip" href="#main">
          Skip to stories
        </a>
        <Nav />
        <div className="page" id="main">
          {children}
        </div>
      </body>
    </html>
  );
}
