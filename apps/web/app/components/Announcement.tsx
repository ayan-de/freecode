import { ExternalLink } from "lucide-react";

export function Announcement() {
  return (
    <a
      href="#"
      className="flex items-center justify-center brand-gradient py-2 text-sm text-white hover:opacity-90 transition-opacity w-full"
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
