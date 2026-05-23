import { useClerk } from "@clerk/react";

export function SuspensionPage({ reason }: { reason: string }) {
  const { signOut } = useClerk();

  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen px-6 text-center"
      style={{ background: "var(--color-bg-base)" }}
    >
      {/* Icon */}
      <div
        className="w-16 h-16 rounded-full flex items-center justify-center mb-6 text-2xl"
        style={{
          background: "rgba(239,68,68,0.10)",
          border: "1px solid rgba(239,68,68,0.25)",
        }}
      >
        🔒
      </div>

      {/* Heading */}
      <h1
        className="text-xl font-bold mb-2"
        style={{ color: "var(--color-fg-default)" }}
      >
        Account Suspended
      </h1>

      {/* Admin message */}
      <p
        className="text-sm max-w-sm mb-8 leading-relaxed"
        style={{ color: "var(--color-fg-muted)" }}
      >
        {reason && reason.trim()
          ? reason
          : "Your account has been suspended. Please contact the administrator for more information."}
      </p>

      {/* Logout */}
      <button
        onClick={() => void signOut()}
        className="px-6 py-2.5 rounded-lg text-sm font-bold"
        style={{
          background: "rgba(239,68,68,0.12)",
          border: "1px solid rgba(239,68,68,0.30)",
          color: "var(--color-accent-red)",
        }}
      >
        Sign out
      </button>
    </div>
  );
}
