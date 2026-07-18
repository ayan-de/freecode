"use client";

import { useEffect, useState } from "react";
import { LandingPage } from "./components/LandingPage";
import { InternalArchitecture } from "./internal/InternalArchitecture";
import { ModeToggle, type ViewMode } from "./components/ModeToggle";

export default function Home() {
  const [mode, setMode] = useState<ViewMode>("user");

  useEffect(() => {
    const saved = localStorage.getItem("viewMode");
    if (saved === "dev" || saved === "user") setMode(saved);
  }, []);

  const changeMode = (next: ViewMode) => {
    setMode(next);
    localStorage.setItem("viewMode", next);
  };

  return (
    <>
      <ModeToggle mode={mode} onChange={changeMode} />
      {mode === "dev" ? <InternalArchitecture /> : <LandingPage />}
    </>
  );
}
