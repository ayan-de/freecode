import { Installation } from "./Installation";
import { Mission } from "./Mission";
import { Benchmark } from "./Benchmark";
import { Footer } from "./Footer";
import { Hero } from "./Hero";
import { PageWrapper } from "./PageWrapper";
import { Announcement } from "./Announcement";

export function LandingPage() {
  return (
    <PageWrapper>
      <div className="px-[max(80px,calc((100vw-1024px)/2))]">
        <Announcement />
      </div>

      <main className="flex flex-col items-center text-center px-[max(80px,calc((100vw-1024px)/2))]">
        <Hero />

        <div className="h-10 w-full flex items-end justify-start">
          <span className="text-muted-foreground/50 text-xl md:text-2xl font-mono font-medium tracking-tight ml-8">#Installation</span>
        </div>

        <div className="w-full pt-4 pb-12">
          <Installation />
        </div>

        <div className="h-10 w-full flex items-end justify-start">
          <span className="text-muted-foreground/50 text-xl md:text-2xl font-mono font-medium tracking-tight ml-8">#Mission</span>
        </div>

        <div className="w-full">
          <Mission />
        </div>

        <div className="h-10 w-full flex items-end justify-start">
          <span className="text-muted-foreground/50 text-xl md:text-2xl font-mono font-medium tracking-tight ml-8">#Benchmark</span>
        </div>

        <div className="w-full">
          <Benchmark />
        </div>
      </main>

      <div className="h-10 w-full flex items-end justify-start px-[max(80px,calc((100vw-1024px)/2))]">
        <span className="text-muted-foreground/50 text-xl md:text-2xl font-mono font-medium tracking-tight ml-8">#Footer</span>
      </div>

      <div className="px-[max(80px,calc((100vw-1024px)/2))] pt-4 pb-12">
        <Footer />
      </div>

      <div className="h-10 w-full flex items-end justify-start px-[max(80px,calc((100vw-1024px)/2))] pb-4">
        <span className="text-muted-foreground/50 text-xl md:text-2xl font-mono font-medium tracking-tight ml-8">#Freecode</span>
      </div>
    </PageWrapper>
  );
}
