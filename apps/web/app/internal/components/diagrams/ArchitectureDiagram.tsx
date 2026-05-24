import styles from './ArchitectureDiagram.module.css';

interface NodeData {
  id: string;
  label: string;
  sublabel?: string;
  icon?: string;
}

interface ArchitectureDiagramProps {
  nodes: NodeData[];
  connections: Array<{ from: string; to: string; label?: string }>;
  title?: string;
  subtitle?: string;
}

export function ArchitectureDiagram({
  nodes,
  connections,
  title,
  subtitle,
}: ArchitectureDiagramProps) {
  return (
    <div className={styles.container}>
      {title && <h3 className={styles.title}>{title}</h3>}
      {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      <div className={styles.diagram}>
        <svg className={styles.svg} viewBox="0 0 800 400">
          <defs>
            <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(99, 102, 241, 0.5)" />
              <stop offset="100%" stopColor="rgba(168, 85, 247, 0.5)" />
            </linearGradient>
            <filter id="glow">
              <feGaussianBlur stdDeviation="2" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {connections.map((conn, i) => {
            const fromNode = nodes.find((n) => n.id === conn.from);
            const toNode = nodes.find((n) => n.id === conn.to);
            if (!fromNode || !toNode) return null;
            const fromIndex = nodes.indexOf(fromNode);
            const toIndex = nodes.indexOf(toNode);
            const x1 = 100 + fromIndex * 200;
            const y1 = 200;
            const x2 = 100 + toIndex * 200;
            const y2 = 200;
            return (
              <g key={i}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="url(#lineGradient)"
                  strokeWidth="2"
                  filter="url(#glow)"
                  className={styles.connectionLine}
                />
                <polygon
                  points={`${x2 - 10},${y2 - 5} ${x2},${y2} ${x2 - 10},${y2 + 5}`}
                  fill="rgba(168, 85, 247, 0.7)"
                />
                {conn.label && (
                  <text
                    x={(x1 + x2) / 2}
                    y={y1 - 15}
                    className={styles.connectionLabel}
                  >
                    {conn.label}
                  </text>
                )}
              </g>
            );
          })}
          {nodes.map((node, i) => (
            <g key={node.id} transform={`translate(${100 + i * 200}, 160)`}>
              <rect
                x="-60"
                y="-40"
                width="120"
                height="80"
                rx="12"
                className={styles.nodeBox}
                filter="url(#glow)"
              />
              <text x="0" y="-10" className={styles.nodeLabel}>
                {node.label}
              </text>
              {node.sublabel && (
                <text x="0" y="10" className={styles.nodeSublabel}>
                  {node.sublabel}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}