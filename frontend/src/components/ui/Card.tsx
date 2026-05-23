import { clsx } from "clsx";

interface Props {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  /** Semantic tint variant — uses background tint instead of left-border accent. */
  accent?: "green" | "yellow" | "red" | "none";
}

const accentStyles = {
  green:  "bg-[var(--color-green-tint)] border-[var(--color-green-border)]",
  yellow: "bg-[var(--color-amber-tint)] border-[var(--color-amber-border)]",
  red:    "bg-[var(--color-red-tint)] border-[var(--color-red-border)]",
  none:   "bg-[var(--bg-surface)] border-[var(--bg-border)]",
};

export function Card({ children, className, onClick, accent = "none" }: Props) {
  return (
    <div
      onClick={onClick}
      className={clsx(
        "border rounded-[var(--radius-md)]",
        accentStyles[accent],
        onClick && "cursor-pointer active:opacity-80",
        className
      )}
    >
      {children}
    </div>
  );
}
