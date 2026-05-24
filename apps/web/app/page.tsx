import { Button } from "@repo/ui/button";
import { logoLines, logoTagline } from "./assets/logo";
import { Installation } from "./components/Installation";
import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <div className={styles.logoBlock}>
          <pre className={styles.logo}>{logoLines.join("\n")}</pre>
          <p className={styles.tagline}>{logoTagline}</p>
        </div>

        <div className={styles.hero}>
          <h1 className={styles.title}>Your AI Coding Assistant</h1>
          <p className={styles.subtitle}>
            Drive AI coding assistants via browser automation. No API costs.
            Works with ChatGPT, Claude, and Gemini.
          </p>
        </div>

        <Installation />

        <div className={styles.ctas}>
          <a className={styles.primary} href="/internal">
            View Architecture
          </a>
          <a
            href="https://github.com/ayan-de/freecode"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.secondary}
          >
            GitHub
          </a>
        </div>

        <Button appName="web" className={styles.secondary}>
          Open alert
        </Button>
      </main>
      <footer className={styles.footer}>
        <a href="https://freecode.ayande.xyz/" target="_blank" rel="noopener noreferrer">
          freecode.ayande.xyz
        </a>
        <a href="https://github.com/ayan-de/freecode" target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
      </footer>
    </div>
  );
}