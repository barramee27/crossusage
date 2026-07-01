import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import {
  formatCountNumber as formatLocaleCountNumber,
  formatFixedPrecisionNumber as formatLocaleFixedPrecisionNumber,
} from "@/lib/locale-format"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

export function formatFixedPrecisionNumber(value: number): string {
  return formatLocaleFixedPrecisionNumber(value)
}

export function formatCountNumber(value: number): string {
  return formatLocaleCountNumber(value)
}
