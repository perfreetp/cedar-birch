// 导出: 当前视角 PNG + 粒子统计 JSON
function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(
    d.getMinutes()
  )}${p(d.getSeconds())}`;
}

export function exportPNG(composer, renderer) {
  // 先确保 composer 输出到默认 framebuffer 再抓取
  composer.render();
  const canvas = renderer.domElement;
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (blob) {
        download(blob, `typhoon-view-${stamp()}.png`);
        resolve(blob);
      } else {
        resolve(null);
      }
    }, 'image/png');
  });
}

export function exportStatsJSON(payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  download(blob, `typhoon-particles-${stamp()}.json`);
  return blob;
}
