interface PageHeaderProps {
  title: string;
  subtitle: string;
}

export function PageHeader({ title, subtitle }: PageHeaderProps) {
  return (
    <header className="text-center mb-12">
      <h1 className="text-5xl font-extrabold bg-gradient-to-r from-indigo-500 to-purple-500 bg-clip-text text-transparent tracking-tight mb-4">
        {title}
      </h1>
      <p className="text-lg text-white/60 max-w-xl mx-auto leading-relaxed">
        {subtitle}
      </p>
    </header>
  );
}
