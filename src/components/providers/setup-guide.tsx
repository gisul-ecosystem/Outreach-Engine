import { BookOpenIcon } from "lucide-react";

/** Step-by-step Microsoft 365 setup (same steps as the README section "Microsoft 365 setup"). */
export function SetupGuide() {
  return (
    <details className="group rounded-lg border bg-muted/30 p-4 text-sm">
      <summary className="flex cursor-pointer items-center gap-2 font-medium select-none">
        <BookOpenIcon className="size-4" />
        How to get these values from Microsoft 365 (one-time setup)
      </summary>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-muted-foreground">
        <li>
          Open the <strong>Microsoft Entra admin center</strong> (entra.microsoft.com) →{" "}
          <strong>App registrations</strong> → <strong>New registration</strong>. Any name, single
          tenant, no redirect URI.
        </li>
        <li>
          <strong>API permissions</strong> → Add a permission → Microsoft Graph →{" "}
          <strong>Application permissions</strong> → <code>Mail.Send</code> (optional:{" "}
          <code>User.Read.All</code>). Then click <strong>Grant admin consent</strong>.
        </li>
        <li>
          <strong>Certificates &amp; secrets</strong> → New client secret. Copy the secret{" "}
          <strong>Value</strong> right away (it is shown only once) and note the expiry date.
        </li>
        <li>
          From the app&apos;s <strong>Overview</strong> page copy the{" "}
          <strong>Directory (tenant) ID</strong> and <strong>Application (client) ID</strong>. Paste
          all three here and click <strong>Verify</strong>.
        </li>
        <li>
          Strongly recommended: limit the app to only your sending mailboxes (Exchange &quot;RBAC
          for Applications&quot; or an application access policy), so it cannot send as anyone else
          in the company.
        </li>
        <li>
          Each domain must already be verified in the Microsoft 365 admin center, and each inbox
          must already exist there. This app does not create mailboxes.
        </li>
      </ol>
      <p className="mt-3 text-muted-foreground">
        Full guide with the exact PowerShell commands: open <code>README.md</code> in the project
        folder → section <strong>Microsoft 365 setup</strong>.
      </p>
    </details>
  );
}
