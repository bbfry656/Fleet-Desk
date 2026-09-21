const wikiCatalog = window.VEHICLE_CATALOG || [];
let wikiSelected = '';
let wikiListLimit = 120;
const wikiEsc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const wikiMoney = value => value ? '$' + Number(value).toLocaleString('ru-RU') : '—';
function renderWikiList() {
  const q = document.querySelector('#wikiSearch').value.trim().toLowerCase();
  const found = wikiCatalog.filter(x => `${x.name} ${x.id}`.toLowerCase().includes(q));
  const shown = found.slice(0, wikiListLimit);
  document.querySelector('#wikiList').innerHTML = shown.map(x => `<button class="wiki-list-item ${x.id===wikiSelected?'active':''}" data-wiki-id="${wikiEsc(x.id)}"><img loading="lazy" src="${wikiEsc(x.image)}" alt=""><span><b>${wikiEsc(x.name)}</b><small>${wikiEsc(x.id)}</small></span></button>`).join('') + (found.length>shown.length?`<span class="wiki-list-more">Показано ${shown.length} из ${found.length} — прокрутите ниже</span>`:'');
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
  try{renderWikiInfoV2(await window.desktop.getVehicleInfo(id))}catch(error){document.querySelector('#wikiContent').innerHTML=`<div class="wiki-error"><b>Не удалось загрузить карточку</b><span>${wikiEsc(error?.message||'Проверьте подключение к интернету')}</span></div>`}
}
function renderWikiInfoV2(data) {
  const item=wikiCatalog.find(x=>x.id===data.model)||{},local=(window.VEHICLE_PRICES||{})[data.model]||{};
  const tileMap=Object.fromEntries((data.tiles||[]).map(x=>[x.label,x.value]));
  const gov=local.govPrice||Number(String(tileMap['Гос. цена']||'').replace(/\D/g,''));
  const saved=typeof state!=='undefined'?state.vehicles?.find(x=>x.catalogId===data.model):null;
  const scrap=+saved?.scrap||local.mcScrapPrice||local.scrapPrice||(gov?Math.round(gov/2):0);
  const tuning=data.tuning||{},tuningTotal=['engine','box','breaks','turbo'].flatMap(k=>tuning[k]||[]).reduce((s,x)=>s+(+x||0),0);
  const overview=`<div class="wiki-hero"><article class="wiki-panel"><div class="wiki-image"><img src="${wikiEsc(data.image||item.image)}" alt="${wikiEsc(data.title||item.name)}"></div><h2 class="wiki-title">${wikiEsc(data.title||item.name)}</h2><span class="wiki-id">ID: ${wikiEsc(data.model)}</span><div class="wiki-price-row"><div class="wiki-price"><small>ГОС. ЦЕНА</small><b>${wikiMoney(gov)}</b></div><div class="wiki-price scrap"><small>СВАЛКА</small><b>${wikiMoney(scrap)}</b></div></div></article><article class="wiki-panel"><div class="wiki-section-head"><h3>Характеристики</h3><small>Fletcher Wiki</small></div><div class="wiki-stats">${(data.tiles||[]).filter(x=>!['Гос. цена','ID спавна'].includes(x.label)).map(x=>`<div class="wiki-stat"><small>${wikiEsc(x.label).toUpperCase()}</small><b>${wikiEsc(x.value)}</b></div>`).join('')}</div><div class="wiki-section-head wiki-origins-head"><h3>Где получить</h3></div><div class="wiki-sources">${(data.sources||[]).map(x=>`<span class="wiki-source">${wikiEsc(x.label)}</span>`).join('')||'<span class="wiki-source">Источник не указан</span>'}</div></article></div>`;
  const tuningPane=`<article class="wiki-panel"><div class="wiki-section-head"><div><p class="eyebrow">КАЛЬКУЛЯТОР</p><h3>Полный тюнинг</h3></div><b class="wiki-total">Итого ${wikiMoney(tuningTotal)}</b></div><div class="wiki-tuning">${tuneBlock('Двигатель',tuning.engine)}${tuneBlock('КПП',tuning.box)}${tuneBlock('Тормоза',tuning.breaks)}${tuneBlock('Турбо',tuning.turbo)}</div></article>`;
  const paintPane=`${paintBlock('Основная покраска',data.paint?.main)}${paintBlock('Дополнительная покраска',data.paint?.extra)}${paintBlock('Покраска за Majestic Coin',data.paint?.coins,true)}`||'<div class="wiki-welcome"><b>Покраски не указаны</b></div>';
  const visualPane=`${gallery('Обвесы и детали',data.bodykits)}${gallery('Винилы',data.vinyls)}`||'<div class="wiki-welcome"><b>Обвесов и винилов нет</b><span>Для этой модели дополнительные элементы не указаны.</span></div>';
  document.querySelector('#wikiContent').innerHTML=`<div class="wiki-module-tabs"><button class="active" data-wiki-tab="overview">Обзор</button><button data-wiki-tab="tuning">Тюнинг</button><button data-wiki-tab="paint">Покраска</button><button data-wiki-tab="visual">Обвесы и винилы</button></div><div class="wiki-pane active" data-wiki-pane="overview">${overview}</div><div class="wiki-pane" data-wiki-pane="tuning">${tuningPane}</div><div class="wiki-pane" data-wiki-pane="paint">${paintPane}</div><div class="wiki-pane" data-wiki-pane="visual">${visualPane}</div><div class="wiki-attribution"><span>Данные Fletcher Wiki; фактическая свалка из вашей карточки имеет приоритет.</span><a href="${wikiEsc(data.sourceUrl)}" target="_blank" rel="noreferrer">Открыть источник ↗</a></div>`;
}
document.querySelector('#wikiSearch').addEventListener('input',()=>{wikiListLimit=120;renderWikiList()});
document.querySelector('#wikiList').addEventListener('click',e=>{const b=e.target.closest('[data-wiki-id]');if(b)openWikiVehicle(b.dataset.wikiId)});
document.querySelector('#wikiList').addEventListener('scroll',e=>{const list=e.currentTarget;if(list.scrollTop+list.clientHeight<list.scrollHeight-100)return;const q=document.querySelector('#wikiSearch').value.trim().toLowerCase(),total=wikiCatalog.filter(x=>`${x.name} ${x.id}`.toLowerCase().includes(q)).length;if(wikiListLimit>=total)return;const top=list.scrollTop;wikiListLimit=Math.min(wikiListLimit+120,total);renderWikiList();list.scrollTop=top});
document.querySelector('#wikiContent').addEventListener('click',e=>{const tab=e.target.closest('[data-wiki-tab]');if(!tab)return;document.querySelectorAll('[data-wiki-tab]').forEach(x=>x.classList.toggle('active',x===tab));document.querySelectorAll('[data-wiki-pane]').forEach(x=>x.classList.toggle('active',x.dataset.wikiPane===tab.dataset.wikiTab))});
renderWikiList();
