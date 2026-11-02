"use client";
import type { ButtonHTMLAttributes } from "react";

export function ResultFilterButton({ active = false, onClick, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return <button type="button" aria-pressed={active} onClick={event => { event.stopPropagation(); onClick?.(event); }} className={`cursor-pointer text-left transition hover:ring-2 hover:ring-[#bcd8f1] focus-visible:outline-2 focus-visible:outline-[#118dff] ${active ? "ring-2 ring-[#118dff]" : ""} ${className}`} {...props} />;
}
