(() => {
  const script = document.currentScript;
  if (!script) return;
  const origin = new URL(script.src).origin;
  const title = script.dataset.title || 'Hỏi NAU AI';
  const root = document.createElement('div');
  root.style.cssText =
    'position:fixed;right:24px;bottom:24px;z-index:2147483000;font-family:system-ui,sans-serif';
  const button = document.createElement('button');
  button.textContent = '✦ ' + title;
  button.setAttribute('aria-expanded', 'false');
  button.style.cssText =
    'border:0;background:#174b3a;color:white;border-radius:28px;padding:16px 22px;box-shadow:0 6px 24px #0003;cursor:pointer;font:600 15px system-ui';
  const iframe = document.createElement('iframe');
  iframe.src = origin + '/embed';
  iframe.title = 'NAU AI — tư vấn sinh viên';
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  iframe.setAttribute(
    'sandbox',
    'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox',
  );
  iframe.style.cssText =
    'display:none;width:min(420px,calc(100vw - 32px));height:min(680px,calc(100dvh - 120px));border:1px solid #dde5df;border-radius:20px;background:white;box-shadow:0 12px 48px #0003;position:absolute;bottom:68px;right:0';
  button.onclick = () => {
    const show = iframe.style.display === 'none';
    iframe.style.display = show ? 'block' : 'none';
    button.setAttribute('aria-expanded', String(show));
    button.textContent = show ? 'Đóng ×' : '✦ ' + title;
  };
  root.append(iframe, button);
  document.body.append(root);
})();
