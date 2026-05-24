import styles from './FlowDiagram.module.css';

interface Step {
  id: string;
  title: string;
  description: string;
  details?: string[];
}

interface FlowDiagramProps {
  steps: Step[];
  title?: string;
}

export function FlowDiagram({ steps, title }: FlowDiagramProps) {
  return (
    <div className={styles.container}>
      {title && <h3 className={styles.title}>{title}</h3>}
      <div className={styles.steps}>
        {steps.map((step, index) => (
          <div key={step.id} className={styles.step}>
            <div className={styles.stepNumber}>{index + 1}</div>
            <div className={styles.stepContent}>
              <h4 className={styles.stepTitle}>{step.title}</h4>
              <p className={styles.stepDescription}>{step.description}</p>
              {step.details && step.details.length > 0 && (
                <ul className={styles.details}>
                  {step.details.map((detail, i) => (
                    <li key={i}>{detail}</li>
                  ))}
                </ul>
              )}
            </div>
            {index < steps.length - 1 && <div className={styles.connector} />}
          </div>
        ))}
      </div>
    </div>
  );
}