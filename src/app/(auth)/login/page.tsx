import { MailIcon } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Placeholder only. Phase 1 adds the real login form.
export default function LoginPage() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <MailIcon className="size-5" />
          </div>
          <CardTitle>Outreach Engine</CardTitle>
          <CardDescription>Sign-in will be available in the next phase.</CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}
