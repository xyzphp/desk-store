(function () {
  'use strict';
  const SDK = window.XYZOSSDK;
  const bridge = window.PrinterBridge;
  const $ = id => document.getElementById(id);
  const names = { RUNNING: '打印中', FINISH: '已完成', PAUSE: '已暂停', IDLE: '待机', PREPARE: '准备中', FAILED: '打印失败', SLICING: '切片中' };
  const number = value => value !== null && value !== undefined && Number.isFinite(Number(value));
  let latest = null;
  let stopped = false;
  let started = false;
  let compact = false;
  let restored = false;
  let initialWorkspace = null;
  let generation = 0;
  let stateBusy = false;
  let stateError = '';
  let workspaceError = '';
  let stateTimer, frameTimer, workspaceTimer;
  let stateController, frameController;
  let frameGeneration = 0;
  let frameActive = false;
  let frameAt = '';
  let frameKey = '';

  function metric(id, value, unit) {
    const node = $(id);
    node.replaceChildren();
    if (value === null || value === undefined) { node.textContent = '—'; return; }
    node.append(String(value));
    if (unit) { const span = document.createElement('span'); span.textContent = unit; node.append(span); }
  }

  function message(text, error = false) {
    $('status-message').textContent = text;
    $('status-message').classList.toggle('error', error);
  }

  function isPrinting() {
    return !stopped && !compact && !stateError && latest?.configured && latest.connection.state === 'online' && !latest.connection.stale && latest.print.state === 'RUNNING' && latest.settings.cameraEnabled && !document.hidden;
  }

  function stopCamera() {
    frameGeneration++;
    frameActive = false;
    frameAt = '';
    frameKey = '';
    clearTimeout(frameTimer);
    frameController?.abort();
    frameController = null;
    $('camera-image').removeAttribute('src');
    $('camera-image').hidden = true;
    $('camera').hidden = true;
  }

  function render() {
    const online = !stateError && latest?.connection.state === 'online';
    const fresh = online && !latest.connection.stale;
    $('device-name').textContent = '3d打印监控';
    const deviceName = latest?.settings.name || latest?.model || '拓竹打印机';
    $('device-address').textContent = latest?.configured ? deviceName : '设备尚未完成安装配置';
    $('connection').textContent = online ? '已连接' : latest?.connection.state === 'connecting' && !stateError ? '连接中' : '未连接';
    $('connection').classList.toggle('online', Boolean(online));
    const data = latest?.print;
    $('task-name').textContent = fresh ? data.task || '暂无打印任务' : '等待设备状态';
    $('task-name').title = $('task-name').textContent;
    $('task-state').textContent = fresh ? names[data.state] || data.state || '等待状态' : '未连接';
    const progress = fresh && number(data.progress) ? Math.min(100, Math.max(0, Number(data.progress))) : null;
    $('progress-value').textContent = progress === null ? '—' : Math.round(progress) + '%';
    $('progress').value = progress ?? 0;
    if (progress === null) $('progress').setAttribute('aria-valuetext', '等待设备状态');
    else $('progress').removeAttribute('aria-valuetext');
    metric('remaining-value', fresh && number(data.remainingMinutes) ? Math.max(0, Math.ceil(data.remainingMinutes)) : null, ' 分钟');
    metric('layer-value', fresh && number(data.layer) ? data.layer : null, fresh && number(data.totalLayers) ? ` / ${data.totalLayers}` : '');
    for (const [id, value] of [['nozzle-value', data?.nozzleTemperature], ['bed-value', data?.bedTemperature]]) metric(id, fresh && number(value) ? Number(value).toFixed(1).replace(/\.0$/, '') : null, ' °C');
    if (!isPrinting()) stopCamera();
    else {
      const key = `${latest.settings.id}:${latest.cameraRevision}`;
      if (frameActive && key !== frameKey) stopCamera();
      $('camera').hidden = false;
      if (!frameActive) {
        frameActive = true;
        frameKey = key;
        $('camera-empty').textContent = '正在读取摄像头…';
        $('camera-empty').hidden = false;
        void readFrame(frameGeneration);
      }
    }
    let text = stateError || latest?.connection.error || (fresh && latest.connection.lastSeen ? '状态更新于 ' + new Date(latest.connection.lastSeen).toLocaleTimeString('zh-CN', { hour12: false }) : latest?.configured ? '等待设备状态…' : '请由管理员完成 Go 服务首次安装配置');
    if (fresh && data.fault) text = data.fault;
    if (workspaceError) text = workspaceError;
    message(text, Boolean(stateError || workspaceError || latest?.connection.error || (fresh && data.fault)));
  }

  function denyAccess() {
    stopped = true;
    generation++;
    latest = null;
    initialWorkspace = null;
    clearTimeout(stateTimer);
    clearTimeout(workspaceTimer);
    stopCamera();
    stateController?.abort();
    $('device-name').textContent = '3d打印监控';
    $('device-address').textContent = '';
    $('task-name').textContent = '访问已停止';
    $('task-name').title = '';
    $('task-state').textContent = '未连接';
    for (const id of ['progress-value', 'remaining-value', 'layer-value', 'nozzle-value', 'bed-value']) metric(id, null);
    $('progress').value = 0;
    $('connection').textContent = '无权访问';
    $('connection').classList.toggle('online', false);
    message('访问授权或服务认证已失效，请检查应用配置后重新打开。', true);
  }

  function clearPrivateView() {
    $('device-name').textContent = '3d打印监控';
    $('device-address').textContent = '';
    $('task-name').textContent = '等待设备状态';
    $('task-name').title = '';
    $('task-state').textContent = '未连接';
    $('connection').textContent = '未连接';
    $('connection').classList.toggle('online', false);
    for (const id of ['progress-value', 'remaining-value', 'layer-value', 'nozzle-value', 'bed-value']) metric(id, null);
    $('progress').value = 0;
    message('应用已关闭');
  }

  async function checkedRequest(path, options) {
    const response = await bridge.request(path, options);
    if (response.status === 401 || response.status === 403) { denyAccess(); throw new Error('访问已停止'); }
    return response;
  }

  async function readState() {
    clearTimeout(stateTimer);
    if (stopped || stateBusy || document.hidden) {
      if (!stopped) stateTimer = setTimeout(readState, 2000);
      return;
    }
    stateBusy = true;
    const current = generation;
    stateController = new AbortController();
    try {
      const response = await checkedRequest('/api/printer', { signal: stateController.signal });
      if (!response.ok) throw new Error('监控服务未能返回设备状态');
      const state = await response.json();
      if (!state || !state.settings || !state.connection || !state.print || !state.camera) throw new Error('监控服务状态格式无效');
      if (stopped || current !== generation) return;
      latest = state;
      stateError = '';
      render();
      if (!restored) { restored = true; restoreWorkspace(initialWorkspace); initialWorkspace = null; }
    } catch (error) {
      if (!stopped && current === generation && error.name !== 'AbortError') { stateError = error.message || '无法连接监控服务'; render(); }
    } finally {
      stateBusy = false;
      if (!stopped) stateTimer = setTimeout(readState, 2000);
    }
  }

  async function readFrame(current) {
    if (!isPrinting() || current !== frameGeneration) return;
    frameController = new AbortController();
    try {
      const response = await checkedRequest('/api/camera/frame', { signal: frameController.signal });
      if (stopped || current !== frameGeneration || !isPrinting()) return;
      if (response.status === 409) { stopCamera(); void readState(); return; }
      if (response.status === 404) throw new Error('请更新打印监控服务以支持应用摄像头');
      const frame = await response.json();
      if (!response.ok) throw new Error(frame.error || '暂时无法读取摄像头');
      if (stopped || current !== frameGeneration || !isPrinting()) return;
      if (frame.mimeType !== 'image/jpeg' || typeof frame.imageBase64 !== 'string' || frame.imageBase64.length > 1048576 || !/^[a-zA-Z0-9+/]+={0,2}$/.test(frame.imageBase64) || !Number.isFinite(Date.parse(frame.at)) || Date.now() - Date.parse(frame.at) > 15000) throw new Error('未获取到有效的新画面');
      if (frameAt !== frame.at || !$('camera-image').hasAttribute('src')) $('camera-image').src = 'data:image/jpeg;base64,' + frame.imageBase64;
      frameAt = frame.at;
      $('camera-image').hidden = false;
      $('camera-empty').hidden = true;
      $('camera-label').textContent = `摄像头 · ${Number(frame.width) || 0} × ${Number(frame.height) || 0}`;
    } catch (error) {
      if (!stopped && current === frameGeneration && error.name !== 'AbortError') {
        $('camera-image').removeAttribute('src');
        $('camera-image').hidden = true;
        $('camera-empty').textContent = error.message || '摄像头暂时不可用';
        $('camera-empty').hidden = false;
      }
    } finally {
      if (!stopped && current === frameGeneration && isPrinting()) frameTimer = setTimeout(() => readFrame(current), 2000);
    }
  }

  function captureWorkspace() {
    return {
      version: 2,
      scrollTop: Math.max(0, Math.min(100000, Math.round(window.scrollY || 0))),
    };
  }

  function restoreWorkspace(saved) {
    if (compact || !saved || ![1, 2].includes(saved.version)) return;
    // Old setting drafts are intentionally ignored by the read-only application.
    if (Number.isFinite(saved.scrollTop)) window.scrollTo(0, Math.max(0, Math.min(100000, saved.scrollTop)));
  }

  function queueWorkspace() {
    clearTimeout(workspaceTimer);
    if (compact || !latest || !restored || stopped) return;
    workspaceTimer = setTimeout(async () => {
      if (stopped) return;
      try { await SDK.saveWorkspaceState(captureWorkspace()); workspaceError = ''; }
      catch { if (!stopped) { workspaceError = '界面位置暂未保存'; render(); } }
    }, 300);
  }

  window.addEventListener('scroll', queueWorkspace, { passive: true });

  function start(context = {}) {
    if (stopped || started) return;
    started = true;
    initialWorkspace = compact ? null : context.workspaceState;
    void readState();
  }

  // Desktop cards receive a compact/theme message, not the window SDK init.
  const hostOrigin = new URL(document.baseURI, window.location.href).origin;
  window.addEventListener('message', event => {
    if (stopped || event.source !== window.parent || event.origin !== hostOrigin) return;
    const data = event.data;
    if (!data || data.type !== 'xyzos:widget:theme') return;
    if (data.theme?.theme === 'light' || data.theme?.theme === 'dark') document.documentElement.dataset.theme = data.theme.theme;
    if (typeof data.theme?.accent === 'string' && /^#[a-fA-F0-9]{6}$/.test(data.theme.accent)) document.documentElement.style.setProperty('--accent', data.theme.accent);
    if (data.compact === true && !compact) {
      compact = true;
      document.body.classList.toggle('is-compact', true);
      initialWorkspace = null;
      clearTimeout(workspaceTimer);
      stopCamera();
      if (latest) render();
      start();
    }
  });

  document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); else if (!stopped) { render(); void readState(); } });
  window.addEventListener('pagehide', () => {
    stopped = true;
    generation++;
    clearTimeout(stateTimer);
    clearTimeout(workspaceTimer);
    stateController?.abort();
    stopCamera();
    clearPrivateView();
    latest = null;
    initialWorkspace = null;
  });
  if (!SDK?.inOS) { stopped = true; message('请在桌面系统中安装并打开此应用。', true); }
  else SDK.ready(start);
})();
