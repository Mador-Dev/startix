export function AppLoader({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[var(--color-bg-base)] gap-5">
      <div className="flex flex-col items-center gap-3">
        <img
          src="/startix-mark-128.png"
          alt="Startix"
          width={56}
          height={56}
          style={{ borderRadius: 14 }}
        />
        <span className="text-[var(--color-fg-muted)] text-xs font-medium tracking-widest uppercase">
          {label ?? "Startix"}
        </span>
      </div>
      <div
        className="w-40 rounded-full overflow-hidden bg-[var(--color-border)]"
        style={{ height: 3 }}
      >
        <div
          className="h-full w-1/3 rounded-full bg-[var(--color-fg-default)]"
          style={{ animation: "app-loader-slide 1.5s ease-in-out infinite" }}
        />
      </div>
    </div>
  );
}
