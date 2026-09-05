import Image from "next/image";
import localFont from "next/font/local";
import { Layout, Navbar } from "nextra-theme-docs";
import { getPageMap } from "nextra/page-map";
import "nextra-theme-docs/style.css";
import "./globals.css";

// Departure Mono (Helena Zhang, SIL OFL 1.1) — see app/fonts/OFL.txt.
// Single weight: bold text renders as synthetic bold.
const departureMono = localFont({
  src: "./fonts/DepartureMono-Regular.woff2",
  variable: "--font-departure-mono",
  weight: "400",
  style: "normal",
  display: "swap",
});

export const metadata = {
  title: "FreeCode",
  description: "Documentation for FreeCode",
};

const navbar = (
  <Navbar
    logo={
      <Image src="/logo.svg" alt="FreeCode" width={143} height={30} priority />
    }
    projectLink="https://github.com/ayan-de/freecode"
  />
);

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={departureMono.variable}
      suppressHydrationWarning
    >
      <body>
        <Layout
          navbar={navbar}
          pageMap={await getPageMap()}
        >
          {children}
        </Layout>
      </body>
    </html>
  );
}
