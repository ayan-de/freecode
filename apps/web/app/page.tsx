import { Installation } from "./components/Installation";
import { Benchmark } from "./components/Benchmark";
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

        <div className="h-20 flex items-center justify-center">
          <span className="text-white/30 text-sm font-mono">#Installation</span>
        </div>

        <Divider />

        <div className="mt-12 mb-12">
          <Installation />
        </div>

        <Divider />

        <div className="h-20 flex items-center justify-center">
          <span className="text-white/30 text-sm font-mono">#Benchmark</span>
        </div>

        <Divider />

        <div className="w-full mt-12 mb-12">
          <Benchmark />
        </div>

        <Divider />
      </main>

      <div className="h-20 flex items-center justify-center">
        <span className="text-white/30 text-sm font-mono">#Footer</span>
      </div>

      <div className="px-[max(80px,calc((100vw-1280px)/2))]">
        <Divider />
        <Footer />
        <Divider />
      </div>

      <div className="h-20 flex items-center justify-center">
        <span className="text-white/30 text-sm font-mono">#Freecode</span>
      </div>
    </PageWrapper>
  );
}
