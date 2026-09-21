const wikiCatalog = window.VEHICLE_CATALOG || [];
let wikiSelected = '';
const wikiEsc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const wikiMoney = value => value ? '$' + Number(value).toLocaleString('ru-RU') : '—';
function renderWikiList() {
  const q = document.querySelector('#wikiSearch').value.trim().toLowerCase();
  const found = wikiCatalog.filter(x => `${x.name} ${x.id}`.toLowerCase().includes(q));
  const shown = found.slice(0, 120);
  document.querySelector('#wikiList').innerHTML = shown.map(x => `<button class="wiki-list-item ${x.id===wikiSelected?'active':''}" data-wiki-id="${wikiEsc(x.id)}"><img loading="lazy" src="${wikiEsc(x.image)}" alt=""><span><b>${wikiEsc(x.name)}</b><small>${wikiEsc(x.id)}</small></span></button>`).join('') + (found.length>shown.length?`<span class="wiki-list-more">Показаны первые ${shown.length} из ${found.length} — уточните поиск</span>`:'');
}
function tuneBlock(name, levels) {
  if (!Array.isArray(levels) || !levels.length) return '';
  const total = levels.reduce((s,x)=>s+(+x||0),0);
  return `<div class="wiki-tune"><div class="wiki-tune-head"><b>${name}</b><strong>${wikiMoney(total)}</strong></div><div class="wiki-tune-levels">${levels.map(()=>'<i class="wiki-level"></i>').join('')}</div><small>${levels.map((x,i)=>`${i+1} ур. ${wikiMoney(x)}`).join(' • ')}</small></div>`;
}
function paintBlock(title, items, coins=false) {
  if (!items?.length) return '';
  return `<article class="wiki-panel wiki-section"><div class="wiki-section-head"><h3>${title}</h3><small>${items.length} вариантов</small></div><div class="wiki-paints">${items.map(x=>`<div class="wiki-paint"><small>${wikiEsc(x.name)}</small><b>${coins?Number(x.value).toLocaleString('ru-RU')+' MC':wikiMoney(x.value)}</b></div>`).join('')}</div></article>`;
}
function gallery(title, items) {
  if (!items?.length) return '';
  return `<article class="wiki-panel wiki-section"><div class="wiki-section-head"><h3>${title}</h3><small>${items.length} доступно</small></div><div class="wiki-gallery">${items.map(x=>{const image=x.images?.[0]||x.image||'';return `<div class="wiki-gallery-card">${image?`<img loading="lazy" src="${wikiEsc(image)}" alt="">`:''}<div><b>${wikiEsc(x.name||'Элемент')}</b><small>${wikiEsc(x.source||x.fraction||'')}</small></div></div>`}).join('')}</div></article>`;
}
function renderWikiInfo(data) {
  const item=wikiCatalog.find(x=>x.id===data.model)||{};
  const local=(window.VEHICLE_PRICES||{})[data.model]||{};
  const tileMap=Object.fromEntries((data.tiles||[]).map(x=>[x.label,x.value]));
  const gov=local.govPrice||Number(String(tileMap['Гос. цена']||'').replace(/\D/g,''));
  const scrap=local.mcScrapPrice||local.scrapPrice||(gov?Math.round(gov/2):0);
  const tuning=data.tuning||{};
  const tuningTotal=['engine','box','breaks','turbo'].flatMap(k=>tuning[k]||[]).reduce((s,x)=>s+(+x||0),0);
  document.querySelector('#wikiContent').innerHTML=`<div class="wiki-hero"><article class="wiki-panel"><div class="wiki-image"><img src="${wikiEsc(data.image||item.image)}" alt="${wikiEsc(data.title||item.name)}"></div><h2 class="wiki-title">${wikiEsc(data.title||item.name)}</h2><span class="wiki-id">ID: ${wikiEsc(data.model)}</span><div class="wiki-price-row"><div class="wiki-price"><small>ГОС. ЦЕНА</small><b>${wikiMoney(gov)}</b></div><div class="wiki-price scrap"><small>СВАЛКА</small><b>${wikiMoney(scrap)}</b></div></div><div class="wiki-sources">${(data.sources||[]).map(x=>`<span class="wiki-source">${wikiEsc(x.label)}</span>`).join('')}</div></article><article class="wiki-panel"><div class="wiki-section-head"><h3>Характеристики</h3><small>Данные Fletcher Wiki</small></div><div class="wiki-stats">${(data.tiles||[]).filter(x=>!['Гос. цена','ID спавна'].includes(x.label)).map(x=>`<div class="wiki-stat"><small>${wikiEsc(x.label).toUpperCase()}</small><b>${wikiEsc(x.value)}</b></div>`).join('')}</div><div class="wiki-section"><div class="wiki-section-head"><h3>Стоимость тюнинга</h3><b class="wiki-total">Итого ${wikiMoney(tuningTotal)}</b></div><div class="wiki-tuning">${tuneBlock('Двигатель',tuning.engine)}${tuneBlock('КПП',tuning.box)}${tuneBlock('Тормоза',tuning.breaks)}${tuneBlock('Турбо',tuning.turbo)}</div></div></article></div>${paintBlock('Основная покраска',data.paint?.main)}${paintBlock('Дополнительная покраска',data.paint?.extra)}${paintBlock('Покраска за Majestic Coin',data.paint?.coins,true)}${gallery('Обвесы и детали',data.bodykits)}${gallery('Винилы',data.vinyls)}<div class="wiki-attribution"><span>Характеристики и тюнинг: Fletcher Wiki. Госцена и свалка продублированы локально.</span><a href="${wikiEsc(data.sourceUrl)}" target="_blank" rel="noreferrer">Открыть источник ↗</a></div>`;
}
async function openWikiVehicle(id) {
  wikiSelected=id;renderWikiList();const item=wikiCatalog.find(x=>x.id===id);document.querySelector('#wikiContent').innerHTML=`<div class="wiki-loading"><b>Загружаю ${wikiEsc(item?.name||id)}</b><span>Собираю характеристики, тюнинг и изображения…</span></div>`;
  if(!window.desktop?.getVehicleInfo){document.querySelector('#wikiContent').innerHTML='<div class="wiki-error"><b>Карточки доступны в установленном приложении</b><span>Запустите Fleet Desk через установщик.</span></div>';return}
  try{renderWikiInfo(await window.desktop.getVehicleInfo(id))}catch(error){document.querySelector('#wikiContent').innerHTML=`<div class="wiki-error"><b>Не удалось загрузить карточку</b><span>${wikiEsc(error?.message||'Проверьте подключение к интернету')}</span></div>`}
}
document.querySelector('#wikiSearch').addEventListener('input',renderWikiList);
document.querySelector('#wikiList').addEventListener('click',e=>{const b=e.target.closest('[data-wiki-id]');if(b)openWikiVehicle(b.dataset.wikiId)});
renderWikiList();
