import Image from "next/image";
import { Layout, Navbar } from "nextra-theme-docs";
import { getPageMap } from "nextra/page-map";
import "nextra-theme-docs/style.css";
import "./globals.css";

export const metadata = {
  title: "FreeCode",
  description: "Documentation for FreeCode",
};

const navbar = (
  <Navbar
    logo={
      <Image src="/logo.svg" alt="FreeCode" width={143} height={30} priority />
    }
    projectLink="https://github.com/thisisayande/freecode"
  />
);

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
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
