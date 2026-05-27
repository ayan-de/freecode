"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Menu, X, Download } from "lucide-react";
import { FaGithub } from "react-icons/fa";
import { Button } from "./Button";
import { Divider } from "./Divider";

const navLinks = [
  { label: "Features", href: "#features" },
  { label: "Docs", href: "#docs" },
];

export function Navbar() {
  const [open, setOpen] = useState(false);

  return (
    <nav className="relative z-50 bg-transparent px-[max(80px,calc((100vw-1280px)/2))]">
      <div className="mx-auto max-w-5xl">
        <div className="flex h-16 items-center justify-between overflow-x-auto">
          <Link href="/" className="flex items-center hover:opacity-80 transition-opacity ml-10">
            <div className="relative h-16 w-36">
              <Image src="/logo.png" alt="freecode" fill sizes="144px" className="object-contain" loading="eager" />
            </div>
          </Link>
          <div className="flex items-center gap-8 flex-1 justify-end">
            {navLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="text-sm text-white/60 hover:text-white transition-colors"
              >
                {link.label}
              </Link>
            ))}
            <a
              href="https://github.com/ayan-de/freecode"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden md:flex items-center gap-2 text-sm text-white/60 hover:text-white transition-colors"
            >
              <FaGithub className="h-4 w-4" />
              Star on GitHub
            </a>
            <Button variant="primary" href="#installation">
              <Download className="h-4 w-4 mr-2" />
              Download
            </Button>
            <button
              className="md:hidden"
              onClick={() => setOpen(!open)}
              aria-label="Toggle menu"
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
        {open && (
          <div className="border-t border-white/10 py-4 md:hidden">
            {navLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="block py-2 text-sm text-white/60 hover:text-white transition-colors"
              >
                {link.label}
              </a>
            ))}
          </div>
        )}
      </div>
      <Divider />
    </nav>
  );
}
