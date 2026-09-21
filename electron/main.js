const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

const oldUserData = path.join(app.getPath('appData'), 'Memphis Fleet Desk');
const newUserData = path.join(app.getPath('appData'), 'Fleet Desk');
if (!fs.existsSync(newUserData) && fs.existsSync(oldUserData)) fs.cpSync(oldUserData, newUserData, { recursive: true });
app.setPath('userData', newUserData);

let mainWindow;
const updateStatus = (status, detail = '') => mainWindow?.webContents.send('update:status', { status, detail });
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.on('checking-for-update', () => updateStatus('checking'));
autoUpdater.on('update-available', info => updateStatus('available', info.version));
autoUpdater.on('update-not-available', () => updateStatus('current'));
autoUpdater.on('download-progress', progress => updateStatus('downloading', String(Math.round(progress.percent))));
autoUpdater.on('update-downloaded', info => updateStatus('ready', info.version));
autoUpdater.on('error', error => updateStatus('error', error?.message || 'Не удалось проверить обновления'));

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1060,
    minHeight: 700,
    backgroundColor: '#090b10',
    titleBarStyle: 'hiddenInset',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow = win;
  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
}

app.whenReady().then(() => {
  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) return updateStatus('development');
    try { await autoUpdater.checkForUpdates(); } catch (error) { updateStatus('error', error?.message); }
  });
  ipcMain.on('update:install', () => autoUpdater.quitAndInstall(false, true));
  ipcMain.handle('backup:save', async (_event, text) => {
    const result = await dialog.showSaveDialog({
      title: 'Сохранить резервную копию',
      defaultPath: `fleet-desk-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return false;
    fs.writeFileSync(result.filePath, text, 'utf8');
    return true;
  });

  ipcMain.handle('backup:open', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Открыть резервную копию',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return fs.readFileSync(result.filePaths[0], 'utf8');
  });

  ipcMain.handle('image:save', async (_event, { base64, format, filename }) => {
    const ext = format === 'image/png' ? 'png' : 'jpg';
    const result = await dialog.showSaveDialog({
      title: 'Сохранить обработанный скриншот',
      defaultPath: `${filename || 'majestic-car'}.${ext}`,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
    });
    if (result.canceled || !result.filePath) return null;
    fs.writeFileSync(result.filePath, Buffer.from(base64.split(',')[1], 'base64'));
    return result.filePath;
  });

  createWindow();
  if (app.isPackaged) setTimeout(() => autoUpdater.checkForUpdates().catch(error => updateStatus('error', error?.message)), 5000);
  app.on('activate', () => BrowserWindow.getAllWindows().length || createWindow());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
