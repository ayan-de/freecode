import { Installation } from "./components/Installation";
import { Divider } from "./components/Divider";
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

        <Divider />

        <div className="mt-12 mb-12">
          <Installation />
        </div>

        <Divider />
      </main>

      <footer className="flex items-center justify-center gap-6 py-4 px-[max(80px,calc((100vw-1280px)/2))] text-sm text-white/40">
        <a href="https://freecode.ayande.xyz/" target="_blank" rel="noopener noreferrer">
          freecode.ayande.xyz
        </a>
        <a href="https://github.com/ayan-de/freecode" target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
      </footer>
    </PageWrapper>
  );
}