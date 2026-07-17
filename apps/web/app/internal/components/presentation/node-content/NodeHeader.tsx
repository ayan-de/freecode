import styles from "../ArchitectureExplorer.module.css";

interface HeaderProps {
  title: string;
  subtext: string;
}

export function NodeHeader({ title, subtext }: HeaderProps) {
  return (
    <div className={styles.header}>
      <div>
        <h4 className={styles.title}>{title}</h4>
        <p className={styles.subtext}>{subtext}</p>
      </div>
    </div>
  );
}
