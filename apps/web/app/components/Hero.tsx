import { Button } from "./Button";
import PixelBlast from "./PixelBlast";
import { FaGithub } from "react-icons/fa";
import { Divider } from "./Divider";

export function Hero() {
  return (
    <div className="relative w-full mb-0 px-4 lg:px-0 min-h-[80vh] flex flex-col justify-between isolate">
      {/* Background Grid */}
      <div className="absolute inset-0 w-full h-full">
        <PixelBlast
          variant="square"
          pixelSize={5}
          color="#7462f2"
          patternScale={3.5}
          patternDensity={1.15}
          pixelSizeJitter={0.85}
          enableRipples
          rippleSpeed={0.4}
          rippleThickness={0.12}
          rippleIntensityScale={1.5}
          liquid={false}
          liquidStrength={0.12}
          liquidRadius={1.2}
          liquidWobbleSpeed={5}
          speed={1.05}
          edgeFade={0.36}
          transparent
        />
      </div>

      {/* Foreground Content */}
      <div className="relative z-10 flex flex-col items-start text-left gap-6 w-full max-w-6xl mx-auto mt-0 py-12 ml-8">
        <h1 className="text-5xl lg:text-[4.5rem] font-bold text-white tracking-tight leading-[1.1] max-w-3xl">
          Your <span className="brand-gradient-text">AI</span> Coding Assistant
        </h1>
        <p className="text-lg lg:text-xl text-white/60 leading-relaxed max-w-xl">
          Drive AI coding assistants via browser automation. No API costs. Works with <span className="text-white font-medium">ChatGPT</span>, <span className="text-white font-medium">Claude</span>, <span className="text-white font-medium">Gemini</span>, and <span className="text-white font-medium brand-gradient-text">Browser</span>.
        </p>

        <div className="flex flex-wrap items-center gap-4 mt-4 mb-2">
          <Button variant="primary" className="px-6 py-3" href="/internal">
            View Architecture
          </Button>
          <Button
            variant="outline"
            className="bg-black px-6 py-3 hover:border-white/20 hover:bg-black h-[46px]"
            href="https://github.com/ayan-de/freecode"
            target="_blank"
            rel="noopener noreferrer"
          >
            <FaGithub className="brand-gradient-text mr-2 h-4 w-4" />
            GitHub
          </Button>
        </div>
      </div>

      <Divider />
    </div>
  );
}