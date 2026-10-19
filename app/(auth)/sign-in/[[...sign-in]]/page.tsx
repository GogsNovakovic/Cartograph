import { Suspense } from "react";
import { SignIn } from "@clerk/nextjs";

// Clerk's own component handles every enabled method, invitation tickets and
// any session task such as picking an organization. It reads the URL, so
// with Cache Components it streams inside Suspense.
export default function SignInPage() {
  return (
    <Suspense>
      <SignIn />
    </Suspense>
  );
}
