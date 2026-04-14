import type { Metadata } from "next";

import { AppAuthProvider } from "@/components/auth/AppAuthProvider";
import { auth0 } from "@/lib/auth0";
import { isAuth0Enabled } from "@/lib/auth0";
import "./globals.css";

export const metadata: Metadata = {
  title: "VisionTranslate | Translate text inside images across the web",
  description:
    "VisionTranslate is a browser extension that detects text inside webpage images and overlays translated text directly on the page.",
  keywords: [
    "VisionTranslate",
    "browser extension",
    "OCR",
    "image translation",
    "manga translation",
    "AI translation"
  ],
  openGraph: {
    title: "VisionTranslate",
    description:
      "Translate foreign-language text embedded in images, manga panels, screenshots, signs, menus, and scanned pages.",
    type: "website"
  }
};

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = auth0 ? await auth0.getSession() : null;

  return (
    <html lang="en">
      <body>
        <AppAuthProvider authEnabled={isAuth0Enabled} user={session?.user}>
          {children}
        </AppAuthProvider>
      </body>
    </html>
  );
}
