import { spawn } from "child_process";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let currentAlertProcess: ReturnType<typeof spawn> | null = null;

export function playAlert(): void {
  stopAlert();
  const soundPath = join(__dirname, "../../assets/alert.mp3");
  currentAlertProcess = spawn("mpg123", ["-q", soundPath]);
  currentAlertProcess.on("error", () => { currentAlertProcess = null; });
}

export function stopAlert(): void {
  if (currentAlertProcess) {
    currentAlertProcess.kill();
    currentAlertProcess = null;
  }
}