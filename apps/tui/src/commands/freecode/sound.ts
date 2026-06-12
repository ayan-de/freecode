import { spawn } from "child_process";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let currentMp3Process: ReturnType<typeof spawn> | null = null;

export function playSound(): void {
  stopSound();
  const soundPath = join(
    __dirname,
    "../../assets/Pee Loon Once Upon A Time In Mumbaai 128 Kbps.mp3",
  );
  currentMp3Process = spawn("mpg123", ["-q", soundPath]);
  currentMp3Process.on("error", () => {
    currentMp3Process = null;
  });
}

export function stopSound(): void {
  if (currentMp3Process) {
    currentMp3Process.kill();
    currentMp3Process = null;
  }
}
