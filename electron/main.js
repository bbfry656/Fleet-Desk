const { app, BrowserWindow, ipcMain, dialog, shell, Notification } = require('electron');
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
async function waitForWikiContent(wikiWindow, selector, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const ready = await wikiWindow.webContents.executeJavaScript(
        `Boolean(document.querySelector(${JSON.stringify(selector)}))`
      );
      if (ready) return true;
    } catch {
      // The anti-DDoS page replaces the document during its redirect.
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}
async function loadWikiVehicle(model) {
  if (!/^[a-z0-9_-]+$/i.test(model)) throw new Error('Некорректный ID транспорта');
  if (wikiCache.has(model)) return wikiCache.get(model);
  const wikiWindow = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  try {
    await wikiWindow.loadURL(`https://fletcher-wiki.com/majestic/vehicles/${model}`);
    await waitForWikiContent(wikiWindow, 'h1, meta[property="og:image"]');
    const raw = await wikiWindow.webContents.executeJavaScript(`(() => { const flight=[...document.scripts].map(s=>{const t=s.textContent.trim();if(!t.startsWith('self.__next_f.push('))return '';try{return JSON.parse(t.slice(19,-1))[1]||''}catch{return ''}}).join('\\n');return {text:document.body.innerText,flight,title:document.querySelector('h1')?.innerText||document.title.split(' на Majestic')[0],image:document.querySelector('meta[property="og:image"]')?.content||''}; })()`);
    const plainValue = value => {
      if (value == null) return '';
      if (typeof value === 'string' || typeof value === 'number') return String(value);
      if (Array.isArray(value)) {
        if (value[0] === '$' && value[3]?.children != null) return plainValue(value[3].children);
        return value.map(plainValue).filter(Boolean).join(' ');
      }
      if (typeof value === 'object') return plainValue(value.children ?? value.props?.children ?? '');
      return '';
    };
    const tiles = (jsonAfter(raw.flight, '"tiles":')?.value || []).map(tile => ({ ...tile, value: plainValue(tile.value).replace(/\s+/g, ' ').trim() }));
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
async function loadWikiCatalog(kind, query='', requestedPage=1) {
  const slug=WIKI_CATALOGS[kind];if(!slug)throw new Error('Неизвестный раздел энциклопедии');
  const page=Math.max(1,Math.min(250,Number(requestedPage)||1));
  const cacheKey=`${kind}:${String(query).trim().toLowerCase()}:${page}`,cached=wikiCatalogCache.get(cacheKey);if(cached&&Date.now()-cached.at<10*60*1000)return cached.value;
  const wikiWindow=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
  try{await wikiWindow.loadURL(`https://fletcher-wiki.com/majestic/${slug}`);const readySelector=kind==='items'||kind==='clothes'?'.fw-list-item':'article';const ready=await waitForWikiContent(wikiWindow,readySelector);if(!ready)throw new Error('Fletcher Wiki не вернула карточки каталога. Повторите загрузку через несколько секунд.');if(query){await wikiWindow.webContents.executeJavaScript(`(()=>{const el=[...document.querySelectorAll('input')].find(x=>/поиск/i.test(x.placeholder||''));if(!el)return;const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(el,${JSON.stringify(String(query))});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))})()`);await new Promise(r=>setTimeout(r,900))}
    if(query){await wikiWindow.webContents.executeJavaScript(`(()=>{const el=[...document.querySelectorAll('input')].find(x=>/поиск|название|модель/i.test(x.placeholder||''));if(!el)return false;el.focus();const value=${JSON.stringify(String(query))},setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;setter?.call(el,value);el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));el.dispatchEvent(new Event('change',{bubbles:true}));const key=Object.keys(el).find(x=>x.startsWith('__reactProps$')),props=key&&el[key];if(typeof props?.onChange==='function')props.onChange({target:el,currentTarget:el,type:'change',bubbles:true});el.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true,key:'Enter'}));return true})()`);await new Promise(r=>setTimeout(r,1200))}
    for(let current=1;current<page;current++){
      const moved=await wikiWindow.webContents.executeJavaScript(`(()=>{const nums=[...document.querySelectorAll('button')].filter(b=>/^\\d+$/.test((b.innerText||'').trim()));if(!nums.length)return false;const row=nums[0].parentElement,next=row.nextElementSibling;if(!next||next.tagName!=='BUTTON'||next.disabled)return false;next.click();return true})()`);
      if(!moved)break;await new Promise(r=>setTimeout(r,500));
    }
    const scraped=await wikiWindow.webContents.executeJavaScript(`(()=>{const kind=${JSON.stringify(kind)};const directImage=src=>{try{const u=new URL(src,location.origin);return u.pathname==='/_next/image'?(u.searchParams.get('url')||src):u.href}catch{return src||''}};const clean=x=>(x||'').replace(/\\s+/g,' ').trim();const valueBeside=(n,label)=>{const p=[...n.querySelectorAll('p')].find(x=>clean(x.textContent)===label),box=p?.parentElement,flow=box?.querySelector('number-flow-react span:last-child');return clean(flow?.textContent||[...box?.querySelectorAll('p')||[]].at(-1)?.textContent||'')};let nodes=[...document.querySelectorAll(kind==='items'||kind==='clothes'?'.fw-list-item':'article')];const items=nodes.map((n,index)=>{const text=n.innerText||'',lines=text.split('\\n').map(x=>x.trim()).filter(Boolean),title=n.querySelector('p.text-base,p.text-sm')?.innerText?.trim()||n.querySelector('img[alt]')?.alt?.trim()||lines[0]||'',link=n.querySelector('a[href]')?.getAttribute('href')||'',image=directImage(n.querySelector('img')?.src||''),price=text.match(/\\$[ \\u00a0]*\\d(?:[\\d \\u00a0]*\\d)?/)?.[0]?.replace(/\\s+/g,' ').trim()||'',id=text.match(/ID:[ \\u00a0]*(\\d+)/i)?.[1]||link.match(/[?&]o=([^&]+)/)?.[1]||link.split('/').filter(Boolean).pop()||String(index+1);const skip=new Set([title,'Подробнее','На карте','Гос. цена','Новое',price]);let details=[];for(let i=1;i<lines.length;i++){const line=lines[i];if(skip.has(line))continue;if(line==='Расцветок'&&lines[i+1]){details.push('Расцветок: '+lines[++i]);continue}if(line==='$')continue;details.push(line)}const fields=[];const rental=valueBeside(n,'1 день аренды');if(rental)fields.push({label:'Аренда за 1 день',value:'$ '+rental});const storage=n.querySelector('[title="кладовка"]');if(storage)fields.push({label:'Размер кладовки',value:clean(storage.textContent)});const residents=n.querySelector('[title*="подсел"]');if(residents)fields.push({label:'Можно подселить',value:clean(residents.textContent)+' чел.'});const garage=[...n.querySelectorAll('span')].find(x=>/гаражных мест/i.test(x.textContent||''));if(garage)fields.push({label:'Гаражных мест',value:(clean(garage.textContent).match(/\\d+/)||['0'])[0]});const gender=n.querySelector('[title="Женская"]')?'female':n.querySelector('[title="Мужская"]')?'male':'';const variants=kind==='clothes'?[...n.querySelectorAll('button[title]')].map(b=>({name:b.title,image:directImage(b.querySelector('img')?.src||'')})).filter(x=>x.image&&x.name!=='Добавить в избранное').filter((x,i,a)=>a.findIndex(y=>y.image===x.image)===i):[];return{id,name:title,image,price,fields,gender,variants,details:[...new Set(details)].slice(0,10),sourceUrl:link?new URL(link,location.origin).href:location.href}}).filter(x=>x.name&&!/^Объект \\d+$/i.test(x.name));const pageNumbers=[...document.querySelectorAll('button')].map(b=>Number((b.innerText||'').trim())).filter(Number.isFinite).filter(Boolean),totalPages=Math.max(1,...pageNumbers);return{items,totalPages}})()`);
    if(kind==='homes'){
      const rentals=await wikiWindow.webContents.executeJavaScript(`(()=>[...document.querySelectorAll('article')].map(n=>{const clean=x=>(x||'').replace(/\s+/g,' ').trim(),link=n.querySelector('a[href]')?.href||'',label=[...n.querySelectorAll('p')].find(x=>clean(x.textContent)==='1 день аренды'),box=label?.parentElement,flow=box?.querySelector('number-flow-react');const candidates=[flow?.getAttribute('aria-label'),flow?.getAttribute('data-value'),flow?.value,flow?.shadowRoot?.textContent,box?.innerText,box?.textContent,...[...(box?.querySelectorAll('[aria-label],[data-value]')||[])].flatMap(x=>[x.getAttribute('aria-label'),x.getAttribute('data-value')])].map(clean).filter(Boolean);let value='';for(const candidate of candidates){const match=candidate.replace('1 день аренды',' ').match(/\d[\d\s\u00a0.,]*/);if(match){value=match[0].replace(/\D/g,'');if(value)break}}return{link,value}}))()`);
      for(const item of scraped.items){
        const rental=rentals.find(x=>x.link===item.sourceUrl)?.value||'';
        item.fields=(item.fields||[]).filter(x=>x.label!=='Аренда за 1 день');
        if(rental)item.fields.unshift({label:'Аренда за 1 день',value:`$ ${Number(rental).toLocaleString('ru-RU')}`});
        item.details=[];
      }
    }
    const result={kind,query,page,totalPages:scraped.totalPages,hasMore:page<scraped.totalPages,items:scraped.items,sourceUrl:`https://fletcher-wiki.com/majestic/${slug}`,updatedAt:new Date().toISOString()};wikiCatalogCache.set(cacheKey,{at:Date.now(),value:result});return result;
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
  if (process.platform === 'win32') app.setAppUserModelId('com.fleetdesk.app');
  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) return updateStatus('development');
    try { await autoUpdater.checkForUpdates(); } catch (error) { updateStatus('error', error?.message); }
  });
  ipcMain.on('update:install', () => autoUpdater.quitAndInstall(true, true));
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
  ipcMain.handle('wiki:catalog', async (_event, payload) => loadWikiCatalog(payload?.kind,payload?.query,payload?.page));
  ipcMain.on('notification:show', (_event, payload) => {
    if (!Notification.isSupported() || !payload?.title) return;
    new Notification({ title: String(payload.title), body: String(payload.body || ''), silent: true }).show();
  });

  createWindow();
  if (app.isPackaged) setTimeout(() => autoUpdater.checkForUpdates().catch(error => updateStatus('error', error?.message)), 5000);
  app.on('activate', () => BrowserWindow.getAllWindows().length || createWindow());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
