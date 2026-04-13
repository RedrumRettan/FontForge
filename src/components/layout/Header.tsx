import { Zap, Github, Terminal } from 'lucide-react';

export function Header() {
  return (
    <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary/20 border border-primary/30">
            <Terminal className="w-4 h-4 text-primary" />
          </div>
          <div>
            <span className="font-bold text-foreground mono text-sm">FontForge</span>
            <span className="text-muted-foreground mono text-xs ml-2 hidden sm:inline">TTF/OTF → BMFont converter</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Zap className="w-3 h-3 text-accent" />
            <span className="hidden sm:inline">Client-side only · No uploads</span>
          </span>
        </div>
      </div>
    </header>
  );
}
