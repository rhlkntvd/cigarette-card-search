import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cigarette Card Search",
  description:
    "Explore the New York Public Library cigarette card collection through natural-language image search.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://iiif.nypl.org" />
      </head>
      <body>{children}</body>
    </html>
  );
}
