const $ = id => document.getElementById(id);
let editing = null;
let jobs = [];
async function send(message) { const result = await chrome.runtime.sendMessage(message); if (!result.ok) throw new Error(result.error); return result; }
async function tabs(selected) {
  const all = await chrome.tabs.query({});
  const list = all.filter(t => /^https?:\/\//i.test(t.url || ''));
  $('tab').replaceChildren();
  for (const t of list) { const option = document.createElement('option'); option.value = t.id; option.textContent = `${t.title || t.url} — 창 ${t.windowId}`; $('tab').append(option); }
  if (selected != null) {
    $('tab').value = String(selected);
    if (!$('tab').value) { const missing = document.createElement('option'); missing.value = ''; missing.textContent = '기존 탭을 찾을 수 없습니다. 탭을 다시 선택하세요'; missing.selected = true; $('tab').prepend(missing); }
  }
  if (!list.length) { const option = document.createElement('option'); option.textContent = '열려 있는 웹사이트 탭이 없습니다'; option.value = ''; $('tab').append(option); }
}
function modeChanged() { $('minuteLabel').hidden = $('mode').value !== 'hourly'; $('intervalLabel').hidden = $('mode').value !== 'interval'; }
function reset() { editing = null; $('form').reset(); $('formTitle').textContent = '새 캡처 일정'; $('cancel').hidden = true; $('message').textContent = ''; modeChanged(); }
function text(tag, value, cls) { const el = document.createElement(tag); el.textContent = value; if (cls) el.className = cls; return el; }
async function render() {
  jobs = (await chrome.storage.local.get('jobs')).jobs || [];
  const root = $('jobs'); root.replaceChildren();
  if (!jobs.length) { root.append(text('p', '등록된 일정이 없습니다.', 'meta')); return; }
  for (const job of jobs) {
    const card = document.createElement('div'); card.className = 'job';
    card.append(text('strong', `${job.prefix} · ${job.enabled ? '활성' : '중지'}`));
    card.append(text('div', `${job.origin} · 탭 ${job.tabId} · ${job.mode === 'hourly' ? `매시 ${job.minute}분` : `매시 ${job.interval}분 간격`}`, 'meta'));
    card.append(text('div', `저장: ${job.directory || '(다운로드 폴더)'}/${job.template}.png`, 'meta'));
    card.append(text('div', job.lastStatus ? `최근 상태: ${job.lastStatus}${job.lastAt ? ' (' + new Date(job.lastAt).toLocaleString('ko-KR') + ')' : ''}` : '아직 캡처 기록이 없습니다.', 'meta'));
    const actions = document.createElement('div'); actions.className = 'job-actions';
    for (const [label, action] of [['지금 캡처', 'capture'], ['수정', 'edit'], ['삭제', 'delete']]) {
      const button = text('button', label, 'secondary'); button.type = 'button'; button.onclick = async () => {
        try {
          $('message').textContent = '';
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
$('refresh').addEventListener('click', () => tabs($('tab').value));
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
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.jobs) render(); });
modeChanged(); tabs(); render();
