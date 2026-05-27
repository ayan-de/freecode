import { Divider } from "../../../components/Divider";

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
    <nav className="relative z-50 bg-transparent px-[max(80px,calc((100vw-1280px)/2))]" role="tablist">
      <div className="flex items-stretch h-20 max-w-7xl mx-auto">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => onTabChange(tab.id)}
              className={`flex-1 flex flex-col items-center justify-center gap-1 border-r border-white/20 transition-all duration-200 last:border-r-0 bg-transparent`}
            >
              <span className={`text-sm font-semibold ${isActive ? 'bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent' : 'text-white'}`}>
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