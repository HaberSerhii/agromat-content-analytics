"use client";
import { cn } from "@/lib/utils";

// ── Btn ──────────────────────────────────────────────────────────────────────
interface BtnProps {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  color?: string;
  className?: string;
}
export function Btn({
  active,
  onClick,
  children,
  color = "#118dff",
  className,
}: BtnProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer border-0",
        className,
      )}
      style={{
        background: active ? color + "22" : "transparent",
        color: active ? color : "var(--text-muted)",
        fontWeight: active ? 700 : 600,
      }}
    >
      {children}
    </button>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────
interface CardProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}
export function Card({ children, className, style }: CardProps) {
  return (
    <div
      className={cn("rounded-2xl p-5 border", className)}
      style={{
        background: "var(--bg-card)",
        borderColor: "var(--border)",
        boxShadow: "var(--shadow-sm)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ── NumInput ─────────────────────────────────────────────────────────────────
interface NumInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}
export function NumInput({
  value,
  onChange,
  placeholder,
  className,
}: NumInputProps) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn(
        "rounded-md px-2 py-1 text-xs font-semibold border outline-none focus:ring-1 focus:ring-blue/40 w-full",
        className,
      )}
      style={{
        background: "var(--bg-input)",
        color: "var(--text-mid)",
        borderColor: "var(--border2)",
      }}
    />
  );
}

// ── StepperInput ─────────────────────────────────────────────────────────────
interface StepperInputProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  color?: string;
  label?: string;
}
export function StepperInput({
  value,
  onChange,
  min = 1,
  max,
  color = "#118dff",
  label,
}: StepperInputProps) {
  return (
    <div className="flex items-center gap-2">
      {label && (
        <span
          className="text-xs font-semibold"
          style={{ color: "var(--text-dim)" }}
        >
          {label}
        </span>
      )}
      <button
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        className="w-6 h-6 rounded-md text-sm font-bold flex items-center justify-center transition-all disabled:opacity-30"
        style={{
          background: "var(--bg-input)",
          color,
          border: `1px solid ${color}44`,
        }}
      >
        −
      </button>
      <span className="text-sm font-bold tabular-nums" style={{ color }}>
        {value}
      </span>
      <button
        onClick={() => onChange(max ? Math.min(max, value + 1) : value + 1)}
        disabled={max ? value >= max : false}
        className="w-6 h-6 rounded-md text-sm font-bold flex items-center justify-center transition-all disabled:opacity-30"
        style={{
          background: "var(--bg-input)",
          color,
          border: `1px solid ${color}44`,
        }}
      >
        +
      </button>
    </div>
  );
}

// ── ActionBtn ─────────────────────────────────────────────────────────────────
interface ActionBtnProps {
  onClick?: () => void;
  children: React.ReactNode;
  variant?: "primary" | "danger" | "ghost" | "blue";
  className?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  "aria-label"?: string;
}
export function ActionBtn({
  onClick,
  children,
  variant = "ghost",
  className,
  disabled,
  style,
  "aria-label": ariaLabel,
}: ActionBtnProps) {
  const styles: Record<string, React.CSSProperties> = {
    primary: {
      background: "var(--accent-positive-soft)",
      color: "var(--accent-positive)",
      border: "1px solid #107c1055",
    },
    danger: {
      background: "var(--accent-negative-soft)",
      color: "var(--accent-negative)",
      border: "1px solid #d1343833",
    },
    ghost: {
      background: "var(--bg-input)",
      color: "var(--text-mid)",
      border: "1px solid var(--border2)",
    },
    blue: {
      background: "var(--bg-input)",
      color: "#118dff",
      border: "1px solid #118dff33",
    },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer disabled:opacity-40",
        className,
      )}
      style={{ ...styles[variant], ...style }}
    >
      {children}
    </button>
  );
}

// ── SelectInput ───────────────────────────────────────────────────────────────
interface SelectInputProps {
  value: string | number;
  onChange: (v: string) => void;
  children: React.ReactNode;
  color?: string;
  className?: string;
}
export function SelectInput({
  value,
  onChange,
  children,
  color = "#118dff",
  className,
}: SelectInputProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "rounded-md px-2 py-1 text-xs font-semibold border outline-none cursor-pointer",
        className,
      )}
      style={{
        background: "var(--bg-input)",
        color,
        borderColor: color + "55",
        fontFamily: "inherit",
      }}
    >
      {children}
    </select>
  );
}
