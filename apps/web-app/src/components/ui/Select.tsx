import React from "react";

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string }[];
}

export const Select: React.FC<SelectProps> = ({ options, className = "", ...props }) => {
  return (
    <select
      className={`w-full bg-bg-tertiary border border-border rounded-md px-3 py-2 text-sm text-gray-100 outline-none transition-all focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/10 cursor-pointer ${className}`}
      {...props}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value} className="bg-bg-secondary text-gray-100">
          {opt.label}
        </option>
      ))}
    </select>
  );
};
