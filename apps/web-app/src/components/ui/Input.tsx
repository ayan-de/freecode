import React from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input: React.FC<InputProps> = ({ className = "", ...props }) => {
  return (
    <input
      className={`w-full bg-bg-tertiary border border-border rounded-md px-3 py-2 text-sm text-gray-100 placeholder-gray-500 outline-none transition-all focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/10 ${className}`}
      {...props}
    />
  );
};
