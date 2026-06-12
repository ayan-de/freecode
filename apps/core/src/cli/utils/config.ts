import * as os from "os";
import * as path from "path";

export function getConfigDir(): string {
  return path.join(os.homedir(), ".freecode");
}
