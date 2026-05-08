import { app, BrowserWindow, shell } from 'electron'
import * as path from 'path'
import * as http from 'http'

// Disable GPU for smoother rendering
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('no-sandbox')

let mainWindow: BrowserWindow | null = null

const isDev = process.env.NODE_ENV === 'development'
const TUI_PORT = 3001

async function waitForTuiServer(timeout = 30000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.get(`http://localhost:${TUI_PORT}`, (res) => {
          if (res.statusCode === 200) resolve()
          else reject(new Error(`Status ${res.statusCode}`))
        })
        req.on('error', reject)
        req.setTimeout(1000, () => {
          req.destroy()
          reject(new Error('timeout'))
        })
      })
      return
    } catch {
      // Server not ready yet, wait and retry
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  throw new Error(`TUI server not available on port ${TUI_PORT} after ${timeout}ms`)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 120,
    height: 40,
    frame: false,
    transparent: false,
    backgroundColor: '#0a0a0a',
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
    show: false,
  })

  const url = isDev
    ? `http://localhost:${TUI_PORT}`
    : `file://${path.join(__dirname, '../tui/.next/server/app/index.html')}`

  mainWindow.loadURL(url)

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  // In dev mode, wait for the Next.js TUI server to be ready
  if (isDev) {
    console.log(`Waiting for TUI server on port ${TUI_PORT}...`)
    try {
      await waitForTuiServer()
      console.log('TUI server ready')
    } catch (e) {
      console.error('Failed to connect to TUI server:', e)
      app.quit()
      return
    }
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})