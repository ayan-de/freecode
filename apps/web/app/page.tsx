import { Installation } from "./components/Installation";
import { Mission } from "./components/Mission";
import { Benchmark } from "./components/Benchmark";
import { Footer } from "./components/Footer";
import { Hero } from "./components/Hero";
import { PageWrapper } from "./components/PageWrapper";
import { Announcement } from "./components/Announcement";

export default function Home() {
  return (
    <PageWrapper>
      <div className="px-[max(80px,calc((100vw-1280px)/2))]">
        <Announcement />
      </div>

      <main className="flex flex-col items-center text-center px-[max(80px,calc((100vw-1280px)/2))]">
        <Hero />

        <div className="h-10 w-full max-w-4xl mx-auto flex items-end justify-start">
          <span className="text-muted-foreground/50 text-xl md:text-2xl font-mono font-medium tracking-tight">#Installation</span>
        </div>

        <div className="w-full pt-4 pb-12">
          <Installation />
        </div>

        <div className="h-10 w-full max-w-4xl mx-auto flex items-end justify-start">
          <span className="text-muted-foreground/50 text-xl md:text-2xl font-mono font-medium tracking-tight">#Mission</span>
        </div>

        <div className="w-full">
          <Mission />
        </div>

        <div className="h-10 w-full max-w-4xl mx-auto flex items-end justify-start">
          <span className="text-muted-foreground/50 text-xl md:text-2xl font-mono font-medium tracking-tight">#Benchmark</span>
        </div>

        <div className="w-full">
          <Benchmark />
        </div>
      </main>

      <div className="h-10 w-full max-w-4xl mx-auto flex items-end justify-start px-6 md:px-0">
        <span className="text-muted-foreground/50 text-xl md:text-2xl font-mono font-medium tracking-tight">#Footer</span>
      </div>

      <div className="px-[max(80px,calc((100vw-1280px)/2))] pt-4 pb-12">
        <Footer />
      </div>

      <div className="h-10 w-full max-w-4xl mx-auto flex items-end justify-start px-6 md:px-0 pb-4">
        <span className="text-muted-foreground/50 text-xl md:text-2xl font-mono font-medium tracking-tight">#Freecode</span>
      </div>
    </PageWrapper>
  );
}
