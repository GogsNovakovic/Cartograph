import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { ThemeControl } from "@/components/theme-control";
import { Wordmark } from "@/components/wordmark";
import { HOME_PATH } from "@/lib/routes";

// The shell every signed-in screen renders inside. The proxy has already
// turned away signed-out requests before this runs.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-9 shrink-0 items-center gap-3 border-b border-border px-3">
        <Wordmark />
        <span aria-hidden className="h-4 w-px bg-border" />
        {/* Switching and inviting both live in Clerk's switcher. Every user
            is always in an organization, so the personal account is hidden. */}
        <OrganizationSwitcher
          hidePersonal
          afterCreateOrganizationUrl={HOME_PATH}
          afterSelectOrganizationUrl={HOME_PATH}
        />
        <div className="flex-1" />
        <ThemeControl />
        <UserButton />
      </header>
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
