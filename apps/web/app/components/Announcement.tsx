import { ExternalLink } from "lucide-react";

export function Announcement() {
  return (
    <a
      href="#"
      className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-md border border-border bg-card hover:bg-accent/5 transition-all text-sm text-foreground w-full group mt-6"
    >
      <span className="font-semibold text-primary">FreeCode raises $5M</span>
      <span className="text-muted-foreground/45">•</span>
      <span className="flex items-center gap-1.5 text-muted-foreground group-hover:text-foreground transition-colors">
        Read the launch announcement
        <ExternalLink className="h-3.5 w-3.5" />
      </span>
    </a>
  );
}
