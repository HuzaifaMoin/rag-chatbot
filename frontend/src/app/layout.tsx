import type { Metadata, Viewport } from "next";
import { Fraunces, Manrope } from "next/font/google";
import NavBar from "@/components/NavBar";
import Toaster from "@/components/Toaster";
import { THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

// Same fonts as the Zerobounds apps: Manrope for text, Fraunces (serif) for headings.
const sans = Manrope({ variable: "--font-sans", subsets: ["latin"] });
const heading = Fraunces({ variable: "--font-heading", subsets: ["latin"], axes: ["SOFT", "WONK"] });

export const metadata: Metadata = {
  title: "RAG Chatbot",
  description: "Chat with your documents, with citations.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf9f4" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0b" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: the theme script may add data-theme before React loads.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sans.variable} ${heading.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        <NavBar />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
