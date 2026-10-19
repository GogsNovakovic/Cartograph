import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { HOME_PATH, SIGN_IN_PATH, SIGN_UP_PATH } from "@/lib/routes";
import { themeScript } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Cartograph",
  description: "Dependency map of a public GitHub repository",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The pre-paint script may add data-theme before React hydrates.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-full flex-col">
        {/* Redirects live here, not on individual components, so every
            sign-in method and every invitation lands on the same page. Which
            methods exist is set in the Clerk dashboard. */}
        <ClerkProvider
          signInUrl={SIGN_IN_PATH}
          signUpUrl={SIGN_UP_PATH}
          signInFallbackRedirectUrl={HOME_PATH}
          signUpFallbackRedirectUrl={HOME_PATH}
          afterSignOutUrl={SIGN_IN_PATH}
          appearance={{
            cssLayerName: "clerk",
            // CSS variables, so Clerk follows the theme control with no
            // separate dark theme to keep in sync.
            variables: {
              colorPrimary: "var(--accent)",
              colorPrimaryForeground: "var(--accent-text)",
              colorBackground: "var(--surface)",
              colorForeground: "var(--text)",
              colorMutedForeground: "var(--muted)",
              colorMuted: "var(--raised)",
              colorNeutral: "var(--text)",
              colorInput: "var(--surface)",
              colorInputForeground: "var(--text)",
              colorBorder: "var(--border)",
              fontFamily: "var(--font-geist-sans)",
              fontSize: "13px",
              borderRadius: "4px",
            },
          }}
        >
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
