const offset = "max(80px, calc((100vw - 1280px) / 2))";

interface Tab {
  id: string;
  label: string;
  description: string;
}

interface TabNavigationProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

export function TabNavigation({ tabs, activeTab, onTabChange }: TabNavigationProps) {
  return (
    <div className="relative">
      <div
        className="absolute top-0 bottom-0 w-px bg-white/15 z-50"
        style={{ left: offset }}
      />
      <div
        className="absolute top-0 bottom-0 w-px bg-white/15 z-50"
        style={{ right: offset }}
      />
      <nav className="relative z-50" role="tablist">
        <div
          className="flex items-stretch h-20"
          style={{ paddingInline: offset }}
        >
          {tabs.map((tab, index) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => onTabChange(tab.id)}
                className={`flex-1 flex flex-col items-center justify-center gap-1 border-r border-white/10 transition-all duration-200 last:border-r-0 ${
                  isActive
                    ? 'bg-gradient-to-r from-indigo-500/20 to-purple-500/20'
                    : 'bg-white/5 hover:bg-white/10'
                }`}
              >
                <span className={`text-sm font-semibold ${isActive ? 'text-white' : 'text-white/60'}`}>
                  {tab.label}
                </span>
                <span className="text-xs text-white/40">{tab.description}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}