import { contextBridge, ipcRenderer } from 'electron'

const api = {
  ping: async (): Promise<string> => ipcRenderer.invoke('ping'),
}

contextBridge.exposeInMainWorld('electronAPI', api)

export type ElectronAPI = typeof api

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
