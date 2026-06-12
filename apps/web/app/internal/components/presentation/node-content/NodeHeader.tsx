import React from "react";
import styles from "../ArchitectureExplorer.module.css";

interface HeaderProps {
  icon: React.ReactNode;
  title: string;
  subtext: string;
}

export function NodeHeader({ icon, title, subtext }: HeaderProps) {
  return (
    <div className={styles.header}>
      <span className={styles.icon}>{icon}</span>
      <div>
        <h4 className={styles.title}>{title}</h4>
        <p className={styles.subtext}>{subtext}</p>
      </div>
    </div>
  );
}
