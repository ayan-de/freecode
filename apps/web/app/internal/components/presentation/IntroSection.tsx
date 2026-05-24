interface IntroSectionProps {
  title: string;
  description: string;
}

export function IntroSection({ title, description }: IntroSectionProps) {
  return (
    <div className="text-center mb-8">
      <h3 className="text-2xl font-bold text-white mb-4">{title}</h3>
      <p className="text-white/60 leading-relaxed max-w-2xl mx-auto">{description}</p>
    </div>
  );
}