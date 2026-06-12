import styles from "./BoundaryDiagram.module.css";

interface Layer {
  name: string;
  components: string[];
  color?: string;
}

interface BoundaryDiagramProps {
  layers: Layer[];
  title?: string;
}

const DEFAULT_COLORS = [
  "rgba(99, 102, 241, 0.3)",
  "rgba(168, 85, 247, 0.3)",
  "rgba(236, 72, 153, 0.3)",
  "rgba(34, 211, 238, 0.3)",
];

export function BoundaryDiagram({ layers, title }: BoundaryDiagramProps) {
  return (
    <div className={styles.container}>
      {title && <h3 className={styles.title}>{title}</h3>}
      <div className={styles.diagram}>
        {layers.map((layer, layerIndex) => (
          <div
            key={layerIndex}
            className={styles.layer}
            style={{
              borderColor:
                layer.color ||
                DEFAULT_COLORS[layerIndex % DEFAULT_COLORS.length],
            }}
          >
            <div className={styles.layerHeader}>
              <span className={styles.layerName}>{layer.name}</span>
            </div>
            <div className={styles.components}>
              {layer.components.map((comp, compIndex) => (
                <div
                  key={compIndex}
                  className={styles.component}
                  style={{
                    borderColor:
                      layer.color ||
                      DEFAULT_COLORS[layerIndex % DEFAULT_COLORS.length],
                  }}
                >
                  {comp}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
