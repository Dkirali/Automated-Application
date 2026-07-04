import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const FIELD_BASE =
  "w-full rounded-field border-[1.5px] border-line bg-card px-3.5 py-2.5 text-[14px] text-ink placeholder:text-[#a89d8d] focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15 transition-colors";

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  hint?: ReactNode;
}

/** Label + text input, matching the Faran form field. */
export function Field({ label, hint, className, id, ...props }: FieldProps) {
  return (
    <label className="flex flex-col gap-1.5" htmlFor={id}>
      {label != null && (
        <span className="text-[13px] font-semibold text-ink">{label}</span>
      )}
      <input
        id={id}
        className={cn(FIELD_BASE, props.readOnly && "bg-input", className)}
        {...props}
      />
      {hint != null && <span className="text-[11.5px] text-muted">{hint}</span>}
    </label>
  );
}

export interface SelectFieldProps
  extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}

/** Label + select, sharing the Field styling. */
export function SelectField({
  label,
  hint,
  className,
  id,
  children,
  ...props
}: SelectFieldProps) {
  return (
    <label className="flex flex-col gap-1.5" htmlFor={id}>
      {label != null && (
        <span className="text-[13px] font-semibold text-ink">{label}</span>
      )}
      <select id={id} className={cn(FIELD_BASE, className)} {...props}>
        {children}
      </select>
      {hint != null && <span className="text-[11.5px] text-muted">{hint}</span>}
    </label>
  );
}
