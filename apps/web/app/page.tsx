import { Installation } from "./components/Installation";
import { Divider } from "./components/Divider";
import { Footer } from "./components/Footer";
import { Navbar } from "./components/Navbar";
import { Hero } from "./components/Hero";
import { PageWrapper } from "./components/PageWrapper";
import { Announcement } from "./components/Announcement";

export default function Home() {
  return (
    <PageWrapper>
      <Navbar />
      <div className="px-[max(80px,calc((100vw-1280px)/2))]">
        <Announcement />
      </div>

      <main className="flex flex-col items-center text-center px-[max(80px,calc((100vw-1280px)/2))]">
        <Hero />

        {/* <LogoSection /> */}

        <Divider />

        <div className="mt-12 mb-12">
          <Installation />
        </div>

        <Divider />
      </main>

      <div className="px-[max(80px,calc((100vw-1280px)/2))]">
        <Footer />
      </div>
    </PageWrapper>
  );
}