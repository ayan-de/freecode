import { Footer, Layout, Navbar } from "nextra-theme-docs";
import { getPageMap } from "nextra/page-map";
import "nextra-theme-docs/style.css";
import "./globals.css";

export const metadata = {
  title: "FreeCode",
  description: "Documentation for FreeCode",
};

const navbar = (
  <Navbar
    logo={<strong>FreeCode</strong>}
    projectLink="https://github.com/thisisayande/freecode"
  />
);

const footer = (
  <Footer>
    {new Date().getFullYear()} © FreeCode. MIT License.
  </Footer>
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
          footer={footer}
          pageMap={await getPageMap()}
        >
          {children}
        </Layout>
      </body>
    </html>
  );
}
