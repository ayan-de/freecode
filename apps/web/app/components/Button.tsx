//this is button component
import { ReactNode } from "react";
import Link from "next/link";

interface ButtonProps {
  variant?: "primary" | "secondary" | "outline";
  children: ReactNode;
  className?: string;
  href?: string;
  target?: string;
  rel?: string;
  onClick?: () => void;
}

export function Button({
  variant = "primary",
  children,
  className = "",
  href,
  target,
  rel,
  onClick,
}: ButtonProps) {
  const baseStyles =
    "inline-flex items-center justify-center rounded-sm px-4 py-2 text-sm font-medium transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none no-underline";

  const variants = {
    primary: "bg-primary text-primary-foreground hover:opacity-90",
    secondary: "bg-secondary text-secondary-foreground hover:opacity-90",
    outline:
      "border border-border text-foreground hover:bg-accent hover:text-accent-foreground hover:no-underline",
  };

  const classNames = `${baseStyles} ${variants[variant]} ${className}`;

  if (href) {
    return (
      <Link href={href} className={classNames} target={target} rel={rel}>
        {children}
      </Link>
    );
  }

  return (
    <button className={classNames} onClick={onClick}>
      {children}
    </button>
  );
}
