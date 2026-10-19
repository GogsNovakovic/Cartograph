import { ThemeControl } from "@/components/theme-control";
import { Wordmark } from "@/components/wordmark";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex h-9 shrink-0 items-center gap-3 border-b border-border px-3">
        <Wordmark />
        <div className="flex-1" />
        <ThemeControl />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-16">
        {children}
      </main>
    </div>
  );
}
