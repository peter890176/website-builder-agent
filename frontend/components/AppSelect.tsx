"use client";

import * as Select from "@radix-ui/react-select";

export type AppSelectOption = {
  value: string;
  label: string;
};

type AppSelectProps = {
  value: string;
  onValueChange: (value: string) => void;
  options: AppSelectOption[];
  placeholder?: string;
  id?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
};

export function AppSelect({
  value,
  onValueChange,
  options,
  placeholder,
  id,
  ariaLabel,
  disabled = false,
  className = "",
}: AppSelectProps) {
  return (
    <Select.Root
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
    >
      <Select.Trigger
        id={id}
        aria-label={ariaLabel}
        className={`flex min-w-0 cursor-pointer items-center justify-between gap-2 text-left disabled:cursor-not-allowed ${className}`}
      >
        <Select.Value placeholder={placeholder} className="min-w-0 flex-1 truncate" />
        <Select.Icon aria-hidden="true" className="shrink-0 text-zinc-500">
          ▾
        </Select.Icon>
      </Select.Trigger>

      <Select.Portal>
        <Select.Content
          position="popper"
          sideOffset={4}
          collisionPadding={8}
          className="z-[100] max-h-[min(20rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950 text-sm text-zinc-100 shadow-2xl"
        >
          <Select.Viewport className="max-h-[min(20rem,var(--radix-select-content-available-height))] overflow-y-auto p-1">
            {options.map((option) => (
              <Select.Item
                key={option.value}
                value={option.value}
                className="relative flex cursor-pointer select-none items-center rounded-md py-2 pl-3 pr-8 text-zinc-200 outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-cyan-500/15 data-[highlighted]:text-cyan-100"
              >
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator className="absolute right-3 text-cyan-300">✓</Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
