const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

const oldUserData = path.join(app.getPath('appData'), 'Memphis Fleet Desk');
const newUserData = path.join(app.getPath('appData'), 'Fleet Desk');
if (!fs.existsSync(newUserData) && fs.existsSync(oldUserData)) fs.cpSync(oldUserData, newUserData, { recursive: true });
app.setPath('userData', newUserData);

let mainWindow;
const wikiCache = new Map();
const wikiCatalogCache = new Map();
const WIKI_CATALOGS = {items:'items',clothes:'clothes',homes:'doma_i_kvartiry',offices:'ofisy_i_sklady',businesses:'biznesy',atms:'bankomaty'};
function jsonAfter(text, marker, from = 0) {
  const markerAt = text.indexOf(marker, from);
  if (markerAt < 0) return null;
  let start = markerAt + marker.length;
  while (start < text.length && !['[', '{'].includes(text[start])) start++;
  if (start >= text.length) return null;
  const open = text[start], close = open === '[' ? ']' : '}';
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
    if (char === '"') quoted = true;
    else if (char === open) depth++;
    else if (char === close && --depth === 0) { try { return { value: JSON.parse(text.slice(start, i + 1)), end: i + 1 }; } catch { return null; } }
  }
  return null;
}
function parsePaint(text) {
  const labels = ['Яркий металлик','Металлик','Насыщ. металлик','Тёмный металлик','Матовый','Матовый металл','Сатин','Металл','Теневой хром','Чистый хром'];
  const lines = text.split('\n').map(x => x.trim()).filter(Boolean);
  const result = { main: [], extra: [], coins: [] };
  let group = '';
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === 'Основная покраска') group = 'main';
    else if (lines[i] === 'Дополнительная покраска') group = 'extra';
    else if (lines[i] === 'Основная покраска за коины') group = 'coins';
    else if (group && labels.includes(lines[i])) { const raw = lines[i + 1] || ''; const value = Number(raw.replace(/\D/g, '')); if (value) result[group].push({ name: lines[i], value }); }
  }
  return result;
}
async function loadWikiVehicle(model) {
  if (!/^[a-z0-9_-]+$/i.test(model)) throw new Error('Некорректный ID транспорта');
  if (wikiCache.has(model)) return wikiCache.get(model);
  const wikiWindow = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  try {
    await wikiWindow.loadURL(`https://fletcher-wiki.com/majestic/vehicles/${model}`);
    const raw = await wikiWindow.webContents.executeJavaScript(`(() => { const flight=[...document.scripts].map(s=>{const t=s.textContent.trim();if(!t.startsWith('self.__next_f.push('))return '';try{return JSON.parse(t.slice(19,-1))[1]||''}catch{return ''}}).join('\\n');return {text:document.body.innerText,flight,title:document.querySelector('h1')?.innerText||document.title.split(' на Majestic')[0],image:document.querySelector('meta[property="og:image"]')?.content||''}; })()`);
    const tiles = jsonAfter(raw.flight, '"tiles":')?.value || [];
    const tuning = jsonAfter(raw.flight, '"prices":')?.value || {};
    const sources = jsonAfter(raw.flight, '"sources":')?.value || [];
    const itemGroups = [];
    let cursor = 0;
    while (true) { const found = jsonAfter(raw.flight, '"items":', cursor); if (!found) break; cursor = found.end; if (Array.isArray(found.value) && found.value.length) itemGroups.push(found.value); }
    const wikiItems = itemGroups.flat().filter(Boolean);
    const vinyls = wikiItems.filter(x => Array.isArray(x.images) && x.images.length);
    const bodykits = wikiItems.filter(x => !Array.isArray(x.images) && (x.image || x.name));
    const info = { model, title: raw.title, image: raw.image, tiles, tuning, sources, vinyls, bodykits, paint: parsePaint(raw.text), sourceUrl: `https://fletcher-wiki.com/majestic/vehicles/${model}` };
    wikiCache.set(model, info);
    return info;
  } finally { if (!wikiWindow.isDestroyed()) wikiWindow.destroy(); }
}
async function loadWikiCatalog(kind, query='') {
  const slug=WIKI_CATALOGS[kind];if(!slug)throw new Error('Неизвестный раздел энциклопедии');
  const cacheKey=`${kind}:${String(query).trim().toLowerCase()}`,cached=wikiCatalogCache.get(cacheKey);if(cached&&Date.now()-cached.at<10*60*1000)return cached.value;
  const wikiWindow=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
  try{await wikiWindow.loadURL(`https://fletcher-wiki.com/majestic/${slug}`);if(query){await wikiWindow.webContents.executeJavaScript(`(()=>{const el=[...document.querySelectorAll('input')].find(x=>/поиск/i.test(x.placeholder||''));if(!el)return;const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(el,${JSON.stringify(String(query))});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))})()`);await new Promise(r=>setTimeout(r,900))}
    const value=await wikiWindow.webContents.executeJavaScript(`(()=>{const kind=${JSON.stringify(kind)},slug=${JSON.stringify(slug)};let nodes=[...document.querySelectorAll(kind==='items'?'.fw-list-item':'article')];if(!nodes.length&&kind==='clothes'){const seen=new Set();nodes=[...document.querySelectorAll('a[href^="/majestic/clothes/"]')].map(a=>{let n=a;while(n.parentElement&&(!n.querySelector('img')||(n.innerText||'').trim().length<15))n=n.parentElement;return n}).filter(n=>{if(seen.has(n))return false;seen.add(n);return true})}return nodes.slice(0,60).map((n,index)=>{const lines=(n.innerText||'').split('\\n').map(x=>x.trim()).filter(Boolean),link=n.querySelector('a[href]')?.getAttribute('href')||'',image=n.querySelector('img')?.src||'',price=(n.innerText||'').match(/\\$\\s*[\\d\\s]+/)?.[0]||'',id=(n.innerText||'').match(/ID:\\s*(\\d+)/i)?.[1]||link.split('/').filter(Boolean).pop()||String(index);return{id,name:lines[0]||('Объект '+(index+1)),image,price,details:lines.filter(x=>x!==lines[0]&&x!=='Подробнее'&&x!=='На карте').slice(0,8),sourceUrl:link?new URL(link,location.origin).href:location.href}})})()`);
    const result={kind,query,items:value,sourceUrl:`https://fletcher-wiki.com/majestic/${slug}`,updatedAt:new Date().toISOString()};wikiCatalogCache.set(cacheKey,{at:Date.now(),value:result});return result;
  }finally{if(!wikiWindow.isDestroyed())wikiWindow.destroy()}
}
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
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
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
  ipcMain.handle('wiki:vehicle', async (_event, model) => loadWikiVehicle(model));
  ipcMain.handle('wiki:catalog', async (_event, payload) => loadWikiCatalog(payload?.kind,payload?.query));

  createWindow();
  if (app.isPackaged) setTimeout(() => autoUpdater.checkForUpdates().catch(error => updateStatus('error', error?.message)), 5000);
  app.on('activate', () => BrowserWindow.getAllWindows().length || createWindow());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
