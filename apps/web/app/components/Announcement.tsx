import { ExternalLink } from "lucide-react";

export function Announcement() {
  return (
    <a
      href="#"
      className="flex items-center justify-center mx-auto px-[max(80px,calc((100vw-1280px)/2))] bg-gradient-to-r from-indigo-600 to-purple-600 py-2 text-sm text-white hover:opacity-90 transition-opacity"
    >
      <span className="font-medium">Command Code raises $5M</span>
      <span className="text-white/60">•</span>
      <span className="flex items-center gap-1 text-white/80 hover:text-white">
        Read the launch announcement
        <ExternalLink className="h-3 w-3" />
      </span>
    </a>
  );
}
