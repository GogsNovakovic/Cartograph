// Class strings for the product's form controls, in a plain module so server
// and client components share them. A value exported from a "use client"
// file reaches a server component as a reference, not a string.

export const BUTTON =
  "h-7 shrink-0 rounded border border-border bg-raised px-2.5 text-[12.5px] font-medium hover:border-muted disabled:text-muted";

export const URL_INPUT =
  "h-7 min-w-0 flex-1 rounded border border-border bg-surface px-2 font-mono text-[12.5px] outline-none placeholder:text-muted focus:border-accent";
