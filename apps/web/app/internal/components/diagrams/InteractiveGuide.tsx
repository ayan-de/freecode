import React from "react";
import { Lightbulb } from "lucide-react";
import styles from "./FreeCodeInternalDiagram.module.css";

export function InteractiveGuide() {
  return (
    <div className={styles.interactiveGuide}>
      <Lightbulb size={16} />
      <span>
        Click on any system component above to inspect its architecture, source
        code files, and execution logs.
      </span>
    </div>
  );
}
