use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};

struct CliState {
    stdin: Mutex<std::process::ChildStdin>,
}

#[tauri::command]
fn send_to_cli(state: State<'_, CliState>, message: String) -> Result<(), String> {
    let mut stdin = state.stdin.lock().map_err(|e| e.to_string())?;
    writeln!(stdin, "{}", message).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Spawn the CLI backend process
            let mut child = Command::new("npx")
                .arg("tsx")
                .arg("../../core/src/server.ts")
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .spawn()
                .expect("Failed to start CLI process");

            let stdin = child.stdin.take().expect("Failed to open stdin");
            let stdout = child.stdout.take().expect("Failed to open stdout");

            // Manage stdin so Tauri commands can access it
            app.manage(CliState {
                stdin: Mutex::new(stdin),
            });

            // Spawn a thread to read stdout and emit events to the frontend
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    match line {
                        Ok(line_content) => {
                            // Forward JSON-RPC output to the React frontend
                            app_handle.emit("cli-message", line_content).unwrap();
                        }
                        Err(e) => {
                            eprintln!("Error reading CLI output: {}", e);
                            break;
                        }
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![send_to_cli])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
