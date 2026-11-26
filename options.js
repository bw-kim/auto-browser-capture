const $ = id => document.getElementById(id);
let editing = null;
let jobs = [];
const themes = ['cream', 'pink', 'blue', 'lavender'];
function applyTheme(value) {
  const theme = themes.includes(value) ? value : 'cream';
  document.documentElement.dataset.theme = theme;
  $('theme').value = theme;
}
async function loadTheme() { applyTheme((await chrome.storage.local.get('theme')).theme); }
$('theme').addEventListener('change', async () => {
  const theme = $('theme').value;
  applyTheme(theme);
  try { await chrome.storage.local.set({theme}); }
  catch (error) { $('message').textContent = '테마를 저장하지 못했습니다: ' + error.message; await loadTheme(); }
});
loadTheme();
async function send(message) { const result = await chrome.runtime.sendMessage(message); if (!result.ok) throw new Error(result.error); return result; }
async function showTabDetails() {
  const details = $('tabDetails');
  const tab = $('tab').value ? await chrome.tabs.get(Number($('tab').value)).catch(() => null) : null;
  details.replaceChildren();
  $('showTab').disabled = !tab;
  if (!tab) { details.textContent = '확인할 탭을 선택해 주세요.'; return; }
  details.append(text('div', `창 ${tab.windowId} · ${tab.index + 1}번째 탭 · 탭 ID ${tab.id}`, 'tab-location'), text('div', tab.url || '', 'tab-url'));
}
async function markTab(tabId, expectedOrigin) { await send({type:'highlight', tabId, origin:expectedOrigin}); }
async function tabs(selected) {
  const all = await chrome.tabs.query({});
  const list = all.filter(t => /^https?:\/\//i.test(t.url || ''));
  $('tab').replaceChildren();
  for (const t of list) { const option = document.createElement('option'); option.value = t.id; option.textContent = `창 ${t.windowId} · ${t.index + 1}번째 탭 · ${t.title || t.url} (ID ${t.id})`; $('tab').append(option); }
  if (selected != null) {
    $('tab').value = String(selected);
    if (!$('tab').value) { const missing = document.createElement('option'); missing.value = ''; missing.textContent = '기존 탭을 찾을 수 없습니다. 탭을 다시 선택하세요'; missing.selected = true; $('tab').prepend(missing); }
  }
  if (!list.length) { const option = document.createElement('option'); option.textContent = '열려 있는 웹사이트 탭이 없습니다'; option.value = ''; $('tab').append(option); }
  await showTabDetails();
}
function modeChanged() { $('minuteLabel').hidden = $('mode').value !== 'hourly'; $('intervalLabel').hidden = $('mode').value !== 'interval'; }
function reset() { editing = null; $('form').reset(); $('formTitle').textContent = '새 캡처 일정'; $('cancel').hidden = true; $('message').textContent = ''; modeChanged(); }
function text(tag, value, cls) { const el = document.createElement(tag); el.textContent = value; if (cls) el.className = cls; return el; }
async function render() {
  jobs = (await chrome.storage.local.get('jobs')).jobs || [];
  const root = $('jobs'); root.replaceChildren();
  if (!jobs.length) { root.append(text('p', '등록된 일정이 없습니다.', 'meta')); return; }
  for (const job of jobs) {
    const card = document.createElement('div'); card.className = `job ${job.enabled ? 'job-enabled' : 'job-disabled'}`;
    const heading = document.createElement('div'); heading.className = 'job-heading';
    heading.append(text('strong', job.prefix));
    const toggleLabel = document.createElement('label'); toggleLabel.className = 'job-toggle';
    const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.checked = job.enabled;
    toggle.setAttribute('role', 'switch'); toggle.setAttribute('aria-label', `${job.prefix} 일정 활성화`);
    toggle.addEventListener('change', async () => {
      toggle.disabled = true;
      try { $('message').textContent = ''; await send({type:'toggle', id:job.id, enabled:toggle.checked}); }
      catch (error) { $('message').textContent = error.message; }
      finally { await render(); }
    });
    const track = document.createElement('span'); track.className = 'toggle-track'; track.setAttribute('aria-hidden', 'true');
    toggleLabel.append(toggle, track, text('span', job.enabled ? '활성' : '비활성', 'toggle-status'));
    heading.append(toggleLabel); card.append(heading);
    card.append(text('div', `${job.origin} · 탭 ${job.tabId} · ${job.mode === 'hourly' ? `매시 ${job.minute}분` : `매시 ${job.interval}분 간격`}`, 'meta'));
    card.append(text('div', `저장: ${job.directory || '(다운로드 폴더)'}/${job.template}.png`, 'meta'));
    card.append(text('div', job.lastStatus ? `최근 상태: ${job.lastStatus}${job.lastAt ? ' (' + new Date(job.lastAt).toLocaleString('ko-KR') + ')' : ''}` : '아직 캡처 기록이 없습니다.', 'meta'));
    const actions = document.createElement('div'); actions.className = 'job-actions';
    for (const [label, action] of [['탭 표시', 'view'], ['지금 캡처', 'capture'], ['수정', 'edit'], ['삭제', 'delete']]) {
      const button = text('button', label, 'secondary'); button.type = 'button'; button.onclick = async () => {
        try {
          $('message').textContent = '';
          if (action === 'view') {
            if (job.needsRebind || (job.needsRebind == null && job.lastStatus?.startsWith('브라우저가 다시 시작되었습니다.'))) throw new Error('수정을 눌러 대상 탭을 다시 지정하세요.');
            await markTab(job.tabId, job.origin); return;
          }
          if (action === 'edit') {
            editing = job.id; await tabs(job.tabId); $('prefix').value = job.prefix; $('template').value = job.template; $('directory').value = job.directory; $('mode').value = job.mode; $('minute').value = job.minute; $('interval').value = job.interval; $('enabled').checked = job.enabled; $('formTitle').textContent = '캡처 일정 수정'; $('cancel').hidden = false; modeChanged(); window.scrollTo({top: 0, behavior: 'smooth'}); return;
          }
          if (action === 'delete') { if (!confirm('이 일정을 삭제할까요?')) return; await send({type:'delete', id:job.id}); }
          else { button.disabled = true; await send({type:'capture', id:job.id}); }
        } catch (e) { $('message').textContent = e.message; } finally { button.disabled = false; await render(); }
      }; actions.append(button);
    }
    card.append(actions); root.append(card);
  }
}
$('mode').addEventListener('change', modeChanged);
$('tab').addEventListener('change', () => { showTabDetails().catch(error => { $('message').textContent = error.message; }); });
$('showTab').addEventListener('click', async () => {
  try { $('message').textContent = ''; if (!$('tab').value) throw new Error('확인할 탭을 선택해 주세요.'); await markTab(Number($('tab').value)); }
  catch (error) { $('message').textContent = error.message; }
});
$('refresh').addEventListener('click', () => tabs($('tab').value));
let downloadRoot = null;
$('chooseRoot').addEventListener('click', async () => {
  const status = $('folderMessage');
  status.textContent = '';
  try {
    if (!window.showDirectoryPicker) throw new Error('이 브라우저에서는 폴더 선택을 지원하지 않습니다.');
    const root = await window.showDirectoryPicker({id:'capture-download-root', startIn:'downloads', mode:'read'});
    downloadRoot = root;
    $('chooseDirectory').disabled = false;
    status.textContent = `“${root.name}” 폴더를 선택했습니다. 2번 버튼에서 하위 폴더를 선택해 주세요.`;
  } catch (error) {
    status.textContent = error.name === 'AbortError' ? '폴더 선택을 취소했습니다. 기존 설정은 유지됩니다.' : error.message;
  }
});
$('chooseDirectory').addEventListener('click', async () => {
  const status = $('folderMessage');
  try {
    if (!downloadRoot) throw new Error('먼저 기본 다운로드 폴더를 선택해 주세요.');
    const selected = await window.showDirectoryPicker({id:'capture-download-destination', startIn:downloadRoot, mode:'read'});
    const parts = await downloadRoot.resolve(selected);
    if (parts === null) throw new Error('선택한 폴더가 처음 선택한 다운로드 폴더 안에 없습니다.');
    $('directory').value = parts.join('/');
    status.textContent = parts.length ? `선택한 하위 폴더: ${parts.join(' / ')}` : '기본 다운로드 폴더가 선택되었습니다.';
  } catch (error) {
    status.textContent = error.name === 'AbortError' ? '폴더 선택을 취소했습니다. 기존 설정은 유지됩니다.' : error.message;
  }
});
$('clearDirectory').addEventListener('click', () => { $('directory').value = ''; $('folderMessage').textContent = '기본 다운로드 폴더를 사용합니다.'; });
$('reload').addEventListener('click', render);
$('cancel').addEventListener('click', reset);
$('form').addEventListener('submit', async e => {
  e.preventDefault(); $('message').textContent = '';
  try {
    if (!$('tab').value) throw new Error('대상 웹사이트 탭을 선택하세요.');
    const directory = $('directory').value.trim();
    if (directory.split(/[\\/]+/).some(part => part === '.' || part === '..') || /^[A-Za-z]:/.test(directory) || /^[\\/]/.test(directory)) throw new Error('다운로드 폴더 안의 상대 경로만 입력하세요.');
    await send({type:'save', job:{id: editing || crypto.randomUUID(), tabId:Number($('tab').value), prefix:$('prefix').value.trim(), template:$('template').value.trim(), directory, mode:$('mode').value, minute:Number($('minute').value), interval:Number($('interval').value), enabled:$('enabled').checked}});
    reset(); await render();
  } catch (error) { $('message').textContent = error.message; }
});
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.jobs) render(); if (area === 'local' && changes.theme) applyTheme(changes.theme.newValue); });
modeChanged(); tabs(); render();
