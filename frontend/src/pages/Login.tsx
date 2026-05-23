import { SignIn } from "@clerk/react";

export function Login() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100dvh",
        background: "var(--bg-base)",
        padding: "20px",
        flexDirection: "column",
        gap: 24,
      }}
    >
      <div style={{ textAlign: "center" }}>
        <img
          src="/startix-mark-256.png"
          alt="Startix"
          width={56}
          height={56}
          style={{
            borderRadius: 12,
            display: "block",
            margin: "0 auto 16px",
            background: "#000",
          }}
        />
        <h1
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 700,
            color: "var(--text-primary)",
            letterSpacing: "-0.018em",
            lineHeight: 1.2,
          }}
        >
          Startix
        </h1>
      </div>

      <SignIn routing="hash" />
    </div>
  );
}
