import { Suspense } from "react";
import { getCurrentOrganization } from "@/lib/organization";

export default function WorkspacePage() {
  return (
    <section className="p-3">
      {/* The organization comes from the request's token, so it streams in
          the same HTML response rather than being filled in by the browser. */}
      <Suspense>
        <Organization />
      </Suspense>
    </section>
  );
}

async function Organization() {
  const org = await getCurrentOrganization();

  if (!org) {
    return <p className="text-muted">This session has no active organization.</p>;
  }

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
      <dt className="text-muted">Organization</dt>
      <dd>
        {org.name ?? (
          <span className="text-muted">
            Name not in session token — add the <code className="font-mono">org_name</code> claim
          </span>
        )}
      </dd>
      <dt className="text-muted">Slug</dt>
      <dd className="font-mono">{org.slug ?? <span className="text-muted">none</span>}</dd>
      <dt className="text-muted">ID</dt>
      <dd className="font-mono">{org.id}</dd>
    </dl>
  );
}
