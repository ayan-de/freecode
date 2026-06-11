import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X } from 'lucide-react';

export function Titlebar() {
  const isTauri = typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;

  if (!isTauri) {
    return null;
  }

  const appWindow = getCurrentWindow();

  return (
    <div
      data-tauri-drag-region
      className="h-8 bg-[#111111] flex items-center justify-between select-none border-b border-[#222]"
    >
      <div 
        className="pl-4 flex items-center space-x-4 pointer-events-none text-[#a3a3a3] text-sm"
      >
        <span>FreeCode</span>
        <span className="text-[#555]">|</span>
        <span>Building FreeCode Rust Interface</span>
      </div>

      <div className="flex items-center h-full pr-2 space-x-1">
        <button
          className="w-6 h-6 flex items-center justify-center rounded-full text-[#a3a3a3] hover:bg-[#333] hover:text-white transition-colors"
          onClick={() => appWindow.minimize()}
        >
          <Minus size={12} />
        </button>
        <button
          className="w-6 h-6 flex items-center justify-center rounded-full text-[#a3a3a3] hover:bg-[#333] hover:text-white transition-colors"
          onClick={() => appWindow.toggleMaximize()}
        >
          <Square size={10} />
        </button>
        <button
          className="w-6 h-6 flex items-center justify-center rounded-full text-[#a3a3a3] hover:bg-[#333] hover:text-white transition-colors"
          onClick={() => appWindow.close()}
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
