const PREFIX = 'capture:';
const locks = new Set();

async function getJobs() { return (await chrome.storage.local.get('jobs')).jobs || []; }
async function updateJob(id, patch) {
  const jobs = await getJobs();
  const job = jobs.find(j => j.id === id);
  if (!job) return;
  Object.assign(job, patch);
  await chrome.storage.local.set({jobs});
}
function nextTime(job, now = Date.now()) {
  const d = new Date(now);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  if (job.mode === 'hourly') {
    while (d.getMinutes() !== job.minute) d.setMinutes(d.getMinutes() + 1);
  } else {
    while (d.getMinutes() % job.interval !== 0) d.setMinutes(d.getMinutes() + 1);
  }
  return d.getTime();
}
async function schedule(job) {
  await chrome.alarms.clear(PREFIX + job.id);
  if (job.enabled) await chrome.alarms.create(PREFIX + job.id, {when: nextTime(job)});
}
function safePart(value) {
  return String(value).replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/g, '').trim();
}
function fileName(job, date) {
  const pad = n => String(n).padStart(2, '0');
  const fields = {prefix: job.prefix, YYYY: date.getFullYear(), YY: pad(date.getFullYear() % 100), MM: pad(date.getMonth()+1), DD: pad(date.getDate()), HH: pad(date.getHours()), mm: pad(date.getMinutes()), ss: pad(date.getSeconds())};
  const name = job.template.replace(/\{(prefix|YYYY|YY|MM|DD|HH|mm|ss)\}/g, (_, key) => fields[key]);
  const directory = (job.directory || '').split(/[\\/]+/).filter(Boolean).map(safePart).filter(Boolean).join('/');
  return (directory ? directory + '/' : '') + (safePart(name) || 'capture') + '.png';
}
async function capture(id) {
  if (locks.has(id)) throw new Error('이미 캡처가 진행 중입니다.');
  locks.add(id);
  let attached = false;
  let tabId;
  try {
    const job = (await getJobs()).find(j => j.id === id);
    if (!job) throw new Error('설정을 찾을 수 없습니다.');
    tabId = job.tabId;
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || !/^https?:\/\//i.test(tab.url)) throw new Error('HTTP 또는 HTTPS 웹사이트 탭만 캡처할 수 있습니다.');
    if (new URL(tab.url).origin !== job.origin) throw new Error('탭의 사이트가 변경되었습니다. 설정에서 탭을 다시 지정하세요.');
    const target = {tabId};
    await chrome.debugger.attach(target, '1.3');
    attached = true;
    const result = await chrome.debugger.sendCommand(target, 'Page.captureScreenshot', {format: 'png', fromSurface: true});
    const name = fileName(job, new Date());
    await chrome.downloads.download({url: 'data:image/png;base64,' + result.data, filename: name, conflictAction: 'uniquify', saveAs: false});
    await updateJob(id, {lastStatus: '다운로드 시작: ' + name, lastAt: Date.now()});
    return name;
  } catch (error) {
    await updateJob(id, {lastStatus: '오류: ' + (error.message || String(error)), lastAt: Date.now()});
    throw error;
  } finally {
    if (attached) { try { await chrome.debugger.detach({tabId}); } catch (_) {} }
    locks.delete(id);
  }
}
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
chrome.alarms.onAlarm.addListener(async alarm => {
  if (!alarm.name.startsWith(PREFIX)) return;
  const id = alarm.name.slice(PREFIX.length);
  const job = (await getJobs()).find(j => j.id === id);
  if (!job || !job.enabled) return;
  await schedule(job);
  try { await capture(id); } catch (_) {}
});
chrome.runtime.onStartup.addListener(async () => {
  // Tab IDs are session-scoped; never silently bind a job to a different tab.
  const jobs = await getJobs();
  for (const job of jobs) {
    job.enabled = false;
    job.needsRebind = true;
    job.lastStatus = '브라우저가 다시 시작되었습니다. 탭을 다시 지정하고 활성화하세요.';
    await chrome.alarms.clear(PREFIX + job.id);
  }
  await chrome.storage.local.set({jobs});
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  (async () => {
    if (message.type === 'save') {
      const job = message.job;
      if (!job.id || !Number.isInteger(job.tabId) || !['hourly','interval'].includes(job.mode) || !Number.isInteger(job.minute) || job.minute < 0 || job.minute > 59 || !Number.isInteger(job.interval) || job.interval < 1 || job.interval > 60 || !job.template || typeof job.directory !== 'string') throw new Error('설정값을 확인하세요.');
      const tab = await chrome.tabs.get(job.tabId);
      if (!tab.url || !/^https?:\/\//i.test(tab.url)) throw new Error('HTTP 또는 HTTPS 웹사이트 탭을 선택하세요.');
      job.origin = new URL(tab.url).origin;
      job.needsRebind = false;
      const jobs = await getJobs();
      const index = jobs.findIndex(j => j.id === job.id);
      if (index >= 0) jobs[index] = {...jobs[index], ...job}; else jobs.push(job);
      await chrome.storage.local.set({jobs});
      await schedule(job);
      return {ok: true};
    }
    if (message.type === 'toggle') {
      const jobs = await getJobs();
      const job = jobs.find(j => j.id === message.id);
      if (!job) throw new Error('설정을 찾을 수 없습니다.');
      if (message.enabled) {
        if (job.needsRebind || (job.needsRebind == null && job.lastStatus?.startsWith('브라우저가 다시 시작되었습니다.'))) throw new Error('브라우저가 다시 시작되었습니다. 수정을 눌러 탭을 다시 지정하세요.');
        const tab = await chrome.tabs.get(job.tabId).catch(() => null);
        if (!tab?.url || !/^https?:\/\//i.test(tab.url) || new URL(tab.url).origin !== job.origin) throw new Error('대상 탭을 찾을 수 없습니다. 수정을 눌러 탭을 다시 지정하세요.');
      }
      job.enabled = Boolean(message.enabled);
      await chrome.storage.local.set({jobs});
      await schedule(job);
      return {ok: true};
    }
    if (message.type === 'delete') {
      await chrome.alarms.clear(PREFIX + message.id);
      await chrome.storage.local.set({jobs: (await getJobs()).filter(j => j.id !== message.id)});
      return {ok: true};
    }
    if (message.type === 'capture') return {ok: true, filename: await capture(message.id)};
    throw new Error('알 수 없는 요청입니다.');
  })().then(respond, e => respond({ok: false, error: e.message || String(e)}));
  return true;
});
