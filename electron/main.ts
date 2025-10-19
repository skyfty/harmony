import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { release } from 'node:os'

const isDevelopment = !app.isPackaged
const RENDERER_DIST = join(__dirname, '../renderer')
const PRELOAD_DIST = join(__dirname, '../preload')

if (release().startsWith('6.1')) {
  app.disableHardwareAcceleration()
}

if (process.platform === 'win32') {
  app.setAppUserModelId(app.getName())
}

let mainWindow: BrowserWindow | null = null

const createMainWindow = async () => {
  mainWindow = new BrowserWindow({
    title: 'Harmony',
    width: 1280,
    height: 720,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    webPreferences: {
      preload: join(PRELOAD_DIST, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']

  if (isDevelopment && rendererUrl) {
    await mainWindow.loadURL(rendererUrl)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
    return
  }

  await mainWindow.loadFile(join(RENDERER_DIST, 'index.html'))
}

app.whenReady().then(async () => {
  await createMainWindow()

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

ipcMain.handle('ping', async () => {
  return 'pong'
})
