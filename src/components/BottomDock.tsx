import { Link, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { Swords, Layers, BookOpen, Terminal } from "lucide-react";

// Exodia NFT Battles — fixed bottom command dock (mobile-first navigation).
// Hidden while the immersive duel page module is active (full-screen takeover).
const DOCK_ITEMS = [
  { to: "/arena", label: "Arena", icon: Swords },
  { to: "/vault", label: "Deck", icon: Layers },
  { to: "/codex", label: "Codex", icon: BookOpen },
  { to: "/settings", label: "Terminal", icon: Terminal },
] as const;

export function BottomDock({ hidden = false }: { hidden?: boolean }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav
      aria-hidden={hidden}
      aria-label="Exodia NFT Battles primary navigation"
      className={cn(
        "fixed bottom-0 left-0 right-0 h-16 bg-slate-950/80 backdrop-blur-md border-t border-slate-800/80",
        "flex items-center justify-around z-50 px-4 pb-safe",
        "shadow-[0_-4px_20px_rgba(0,0,0,0.5)] transition-opacity",
        hidden && "pointer-events-none opacity-0",
      )}
    >
      {DOCK_ITEMS.map((item) => {
        const active = pathname === item.to || pathname.startsWith(item.to + "/");
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            tabIndex={hidden ? -1 : 0}
            className={cn(
              "group relative flex h-full min-w-[64px] flex-col items-center justify-center gap-0.5 px-2 transition",
              active ? "text-cyan-400" : "text-slate-500 hover:text-cyan-400/80",
            )}
          >
            <Icon
              className={cn(
                "h-5 w-5 transition-all",
                active && "scale-110 drop-shadow-[0_0_6px_rgba(34,211,238,0.8)]",
              )}
            />
            <span className="text-[10px] uppercase tracking-[0.2em]">{item.label}</span>
            {active && (
              <span className="absolute inset-x-2 bottom-1 h-0.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.9)]" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
