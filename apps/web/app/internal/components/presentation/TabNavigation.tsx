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
    <nav className="relative z-50 bg-transparent" role="tablist">
      <div className="flex items-stretch h-20">
        {tabs.map((tab) => {
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
  );
}