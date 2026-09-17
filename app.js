/* ============================================================
   INQUADRAMI — generatore di QR brandizzati con verifica di lettura
   Tutto client-side: qr-code-styling per il disegno, jsQR per la verifica.
   ============================================================ */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // ---------- Costanti ----------
  const Q = 1000;            // lato del QR in unità SVG
  const ECC_H = 0.30;        // capacità di correzione del livello H
  const SAFE_COVER = 0.15;   // frazione di moduli coperti dal logo oltre cui avvisiamo
  const MIN_CONTRAST = 4;    // rapporto WCAG sotto cui avvisiamo
  const VERIFY_BIG_PX_PER_MODULE = 10;    // test "in grande": almeno 800px, di più se il QR è denso
  const VERIFY_SMALL_PX_PER_MODULE = [6, 7, 8]; // test "in piccolo": px per modulo costanti, così misura la
                                          // personalizzazione e non la densità. Tre scale perché jsQR ha
                                          // fallimenti di aliasing a scale isolate: passa con 2 su 3.
  const MM_PER_MODULE = 0.6;     // regola pratica per la dimensione minima di stampa
  const QUIET_MODULES = 2;       // quiet zone attorno al QR (lo standard dice 4; 2 è il compromesso estetico
                                 // scelto, e la verifica jsQR lo convalida a ogni render)

  const VC_FIELDS = ["nome", "cognome", "azienda", "tel", "email", "sito"];
  const VC_COMFORT = 150; // sotto questa lunghezza la vCard resta attorno ai 45-49 moduli

  const DEFAULTS = {
    mode: "link",
    link: "https://www.iltuosito.it",
    vcard: { nome: "", cognome: "", azienda: "", tel: "", email: "", sito: "" },
    data: "https://www.iltuosito.it", // testo effettivamente codificato, derivato da mode
    shape: 'square',
    corner: 'auto',
    colorMode: 'solid',
    color1: '#1b1a1c',
    color2: '#f92273',
    gradAngle: 45,
    bg: '#ffffff',
    logo: null,
    logoSize: 0.4,
    logoMargin: 10,
    frameOn: true,
    frameColor: '#1b1a1c',
    frameText: '#bff747',
    cta: 'INQUADRAMI',
    radius: 40,
    frameW: 4, // spessore cornice in % del lato del QR
    pngSize: 2048,
  };
  let state = { ...DEFAULTS, vcard: { ...DEFAULTS.vcard } };

  // forma moduli → stile dei tre "finder pattern" agli angoli (quando corner = auto)
  const SHAPES = {
    square:  { dots: 'square',  cs: 'square',        cd: 'square' },
    dots:    { dots: 'dots',    cs: 'dot',           cd: 'dot' },
    classy:  { dots: 'classy',  cs: 'extra-rounded', cd: 'dot' },
    rounded: { dots: 'rounded', cs: 'extra-rounded', cd: 'dot' },
  };
  const CORNERS = {
    square:          { cs: 'square',        cd: 'square' },
    'extra-rounded': { cs: 'extra-rounded', cd: 'dot' },
    dot:             { cs: 'dot',           cd: 'dot' },
  };

  // ---------- DOM ----------
  const el = {
    stage: $('#stage'),
    status: $('#status'),
    statusText: $('.status-text'),
    meta: $('#meta'),
    dlSvg: $('#dl-svg'),
    dlPng: $('#dl-png'),
    data: $("#data"),
    modeLink: $("#modeLink"),
    modeVcard: $("#modeVcard"),
    vcNote: $("#vcNote"),
    color1: $('#color1'),
    color2: $('#color2'),
    color2Wrap: $('#color2Wrap'),
    bg: $('#bg'),
    gradAngle: $('#gradAngle'),
    gradAngleWrap: $('#gradAngleWrap'),
    gradAngleOut: $('#gradAngleOut'),
    contrast: $('#contrast'),
    logoFile: $('#logoFile'),
    logoLabel: $('#logoLabel'),
    logoThumb: $('#logoThumb'),
    logoImg: $('#logoImg'),
    logoRemove: $('#logoRemove'),
    logoOpts: $('#logoOpts'),
    logoHint: $('#logoHint'),
    logoSize: $('#logoSize'),
    logoSizeOut: $('#logoSizeOut'),
    logoMargin: $('#logoMargin'),
    logoMarginOut: $('#logoMarginOut'),
    logoNote: $('#logoNote'),
    frameOn: $('#frameOn'),
    frameOpts: $('#frameOpts'),
    frameColor: $('#frameColor'),
    frameText: $('#frameText'),
    cta: $('#cta'),
    radius: $("#radius"),
    frameW: $("#frameW"),
    frameWOut: $("#frameWOut"),
    radiusOut: $('#radiusOut'),
    reset: $("#reset"),
    pngSizeOut: $("#pngSizeOut"),
  };

  // ---------- Utility ----------
  const debounce = (fn, ms) => {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  };
  const escapeXml = (s) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
  const hexToRgb = (h) => {
    const n = parseInt(h.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  };
  const luminance = ({ r, g, b }) => {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const contrastRatio = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const utf8Binary = (s) => Array.from(new TextEncoder().encode(s), (b) => String.fromCharCode(b)).join("");
  const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  // ---------- vCard 3.0 minimale ----------
  const vcEsc = (s) => s.trim().replace(/\\/g, "\\\\").replace(/[,;]/g, (c) => "\\" + c).replace(/\r?\n/g, "\\n");
  function buildVCard(v) {
    if (!VC_FIELDS.some((k) => v[k].trim())) return "";
    const nome = vcEsc(v.nome);
    const cognome = vcEsc(v.cognome);
    const fn = [nome, cognome].filter(Boolean).join(" ") || vcEsc(v.azienda);
    let sito = v.sito.trim();
    if (sito && !/^https?:\/\//i.test(sito)) sito = "https://" + sito;
    const lines = ["BEGIN:VCARD", "VERSION:3.0", `N:${cognome};${nome};;;`, `FN:${fn}`];
    if (v.azienda.trim()) lines.push(`ORG:${vcEsc(v.azienda)}`);
    if (v.tel.trim()) lines.push(`TEL;TYPE=CELL:${v.tel.replace(/[^+\d]/g, "")}`);
    if (v.email.trim()) lines.push(`EMAIL:${vcEsc(v.email)}`);
    if (sito) lines.push(`URL:${vcEsc(sito)}`);
    lines.push("END:VCARD");
    return lines.join("\r\n");
  }
  function refreshData() {
    state.data = state.mode === "vcard" ? buildVCard(state.vcard) : state.link;
    if (state.mode === "vcard") {
      const n = state.data.length;
      el.vcNote.textContent = !n
        ? "Tutti i campi sono opzionali. iPhone e Android aprono direttamente \"Aggiungi ai contatti\"."
        : n <= VC_COMFORT
          ? `${n} caratteri: vCard magra, QR comodo da leggere.`
          : `${n} caratteri: sopra ${VC_COMFORT} il QR si infittisce. Se puoi, togli un campo.`;
    }
  }

  // ---------- Opzioni per qr-code-styling ----------
  function buildOptions() {
    const shape = SHAPES[state.shape];
    const corner = state.corner === 'auto' ? shape : CORNERS[state.corner];
    const fill = state.colorMode === 'gradient'
      ? { gradient: { type: 'linear', rotation: (state.gradAngle * Math.PI) / 180, colorStops: [{ offset: 0, color: state.color1 }, { offset: 1, color: state.color2 }] } }
      : { color: state.color1 };

    return {
      type: 'svg',
      width: Q,
      height: Q,
      margin: 0, // la quiet zone la disegniamo noi in compose()
      // qr-code-styling tronca ogni carattere a un byte (Latin-1): passiamo la stringa già
      // codificata in UTF-8 byte per byte, così accenti ed emoji arrivano corretti ai lettori.
      data: utf8Binary(state.data),
      qrOptions: { errorCorrectionLevel: "H" },
      image: state.logo || undefined,
      imageOptions: { hideBackgroundDots: true, imageSize: state.logoSize, margin: state.logoMargin, crossOrigin: 'anonymous', saveAsBlob: true },
      dotsOptions: { type: shape.dots, ...fill },
      cornersSquareOptions: { type: corner.cs, ...fill },
      cornersDotOptions: { type: corner.cd, ...fill },
      backgroundOptions: { color: state.bg },
    };
  }

  async function buildQR() {
    const qr = new QRCodeStyling(buildOptions());
    const blob = await qr.getRawData('svg');
    const svg = await blob.text();
    let modules = 0;
    try { modules = qr._qr.getModuleCount(); } catch (_) { /* API interna, fallback sotto */ }
    if (!modules) modules = 29;
    return { svg, modules };
  }

  // ---------- Composizione: quiet zone + cornice + CTA ----------
  function compose(innerSvgText, modules) {
    const pad = Math.round((QUIET_MODULES * Q) / modules);
    const inner = new DOMParser().parseFromString(innerSvgText, 'image/svg+xml').documentElement;
    inner.setAttribute('width', Q);
    inner.setAttribute('height', Q);

    const before = [];
    const after = [];
    let W, H;

    if (state.frameOn) {
      const fw = Math.round((Q * state.frameW) / 100);
      const card = Q + 2 * pad;
      const text = state.cta.trim().toUpperCase();
      const bandH = text ? Math.round(Q * 0.17) : 0;
      W = card + 2 * fw;
      H = card + 2 * fw + bandH;
      const rx = state.radius;
      before.push(`<rect width="${W}" height="${H}" rx="${rx}" fill="${state.frameColor}"/>`);
      before.push(`<rect x="${fw}" y="${fw}" width="${card}" height="${card}" rx="${Math.max(0, rx - fw * 0.5)}" fill="${state.bg}"/>`);
      inner.setAttribute('x', fw + pad);
      inner.setAttribute('y', fw + pad);
      if (text) {
        const maxFs = Q * 0.075;
        const fitFs = (W - 2 * fw) / (text.length * 0.78); // stima larghezza glifi bold
        const fs = Math.round(Math.min(maxFs, fitFs));
        const y = Math.round(fw + card + bandH / 2 + fs * 0.36);
        after.push(`<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="'Be Vietnam Pro','Helvetica Neue',Helvetica,Arial,sans-serif" font-weight="800" font-size="${fs}" letter-spacing="${(fs * 0.1).toFixed(1)}" fill="${state.frameText}">${escapeXml(text)}</text>`);
      }
    } else {
      W = H = Q + 2 * pad;
      before.push(`<rect width="${W}" height="${H}" fill="${state.bg}"/>`);
      inner.setAttribute('x', pad);
      inner.setAttribute('y', pad);
    }

    const innerStr = new XMLSerializer().serializeToString(inner);
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${before.join('')}${innerStr}${after.join('')}</svg>`;
  }

  // ---------- Rasterizzazione (per verifica e PNG) ----------
  let fontCss = null; // @font-face con woff2 inline, per avere Be Vietnam Pro anche nel PNG
  async function loadFont() {
    try {
      const css = await (await fetch('https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@800&display=swap')).text();
      const blocks = css.split('@font-face').slice(1);
      const latin = blocks.find((b) => /U\+0000-00FF/.test(b)) || blocks[blocks.length - 1];
      const url = latin.match(/url\(([^)]+)\)/)[1];
      const buf = await (await fetch(url)).arrayBuffer();
      let bin = '';
      new Uint8Array(buf).forEach((b) => { bin += String.fromCharCode(b); });
      fontCss = `@font-face{font-family:'Be Vietnam Pro';font-weight:800;src:url(data:font/woff2;base64,${btoa(bin)}) format('woff2')}`;
    } catch (_) {
      fontCss = null; // fallback silenzioso su Helvetica/Arial
    }
  }

  function rasterize(svg, width, withFont = false) {
    return new Promise((resolve, reject) => {
      let src = svg;
      if (withFont && fontCss) {
        const i = src.indexOf('>') + 1;
        src = src.slice(0, i) + `<style>${fontCss}</style>` + src.slice(i);
      }
      const img = new Image();
      img.onload = async () => {
        try { if (img.decode) await img.decode(); } catch (_) { /* Safari a volte rifiuta decode() sugli SVG: proseguiamo */ }
        const ratio = img.naturalHeight / img.naturalWidth || 1;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = Math.round(width * ratio);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas);
      };
      img.onerror = () => reject(new Error('Rasterizzazione fallita'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src);
    });
  }

  // ---------- Verifica con jsQR ----------
  async function scan(svg, width, inversion) {
    const canvas = await rasterize(svg, width);
    const ctx = canvas.getContext('2d');
    const { data, width: w, height: h } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const r = jsQR(data, w, h, { inversionAttempts: inversion });
    return { found: !!r, ok: !!r && r.data === state.data, data: r ? r.data : null };
  }

  async function verify(svg, modules, compositeW) {
    const px = (ppm) => Math.round((modules * ppm * compositeW) / Q);
    const bigW = Math.max(800, px(VERIFY_BIG_PX_PER_MODULE));
    const big = await scan(svg, bigW, "dontInvert");
    if (!big.found) {
      // "onlyInvert" è rotto in jsQR 1.4: se "dontInvert" fallisce e "attemptBoth" riesce, è invertito
      const inv = await scan(svg, bigW, "attemptBoth");
      if (inv.ok) return { verdict: 'inverted' };
      return { verdict: 'fail' };
    }
    if (!big.ok) return { verdict: 'mismatch', decoded: big.data };
    let passed = 0;
    for (const ppm of VERIFY_SMALL_PX_PER_MODULE) {
      if ((await scan(svg, px(ppm), "dontInvert")).ok) passed++;
    }
    return { verdict: passed >= 2 ? "ok" : "small" };
  }

  function applyVerdict(res) {
    switch (res.verdict) {
      case 'ok':
        setStatus('ok', 'Leggibile', 'Verificato in grande e a tre scale ridotte. Pronto per l\'export.');
        setExport(true);
        break;
      case 'small':
        setStatus('warn', 'Rischio di lettura', 'Si legge in grande ma non in piccolo. Semplifica forme, colori o logo prima di esportare.');
        setExport(false);
        break;
      case 'inverted':
        setStatus('warn', 'Leggibile solo invertito', 'Molti lettori non aprono i QR chiari su sfondo scuro. Scambia i colori dei moduli e dello sfondo.');
        setExport(false);
        break;
      case 'mismatch':
        setStatus('fail', 'Decodifica diversa dal contenuto', 'Il QR si legge ma restituisce un altro testo. Controlla caratteri speciali o emoji.');
        setExport(false);
        break;
      default:
        setStatus('fail', 'Non leggibile', 'Riduci la personalizzazione: logo più piccolo, colori più contrastati, forme più semplici.');
        setExport(false);
    }
  }

  // ---------- Stato UI ----------
  function setStatus(kind, title, sub) {
    el.status.dataset.state = kind;
    el.statusText.innerHTML = escapeXml(title) + (sub ? `<small>${escapeXml(sub)}</small>` : '');
  }
  function setExport(on) {
    el.dlSvg.disabled = !on;
    el.dlPng.disabled = !on;
  }
  function setBusy(on) { el.stage.classList.toggle('is-busy', on); }

  function updateContrast() {
    const stops = state.colorMode === 'gradient' ? [state.color1, state.color2] : [state.color1];
    const bg = hexToRgb(state.bg);
    const bgL = luminance(bg);
    let worst = Infinity;
    let inverted = false;
    for (const s of stops) {
      const c = hexToRgb(s);
      worst = Math.min(worst, contrastRatio(c, bg));
      if (luminance(c) > bgL) inverted = true;
    }
    const low = worst < MIN_CONTRAST;
    el.contrast.dataset.level = low || inverted ? 'warn' : 'ok';
    let txt = `Contrasto ${worst.toFixed(1)}:1`;
    if (inverted) txt += ' · invertito, rischio';
    else if (low) txt += ' · basso, sotto 4:1';
    else txt += ' · ok';
    el.contrast.querySelector('.badge-text').textContent = txt;
  }

  function updatePngSizeOut() {
    const cm = (state.pngSize / 300 * 2.54).toFixed(0);
    el.pngSizeOut.textContent = `${state.pngSize}px · ~${cm} cm a 300 dpi`;
  }

  function updateLogoNote() {
    const cover = state.logoSize * ECC_H; // frazione di moduli nascosti dal logo
    const side = Math.round(Math.sqrt(cover) * 100);
    el.logoSizeOut.textContent = `${side}% del lato`;
    el.logoMarginOut.textContent = state.logoMargin;
    el.logoNote.textContent = cover <= SAFE_COVER
      ? `Copre ~${Math.round(cover * 100)}% dei moduli. Entro il margine di sicurezza (15%).`
      : `Copre ~${Math.round(cover * 100)}% dei moduli. Oltre il 15%: la verifica decide, ma sei al limite.`;
  }

  function syncUI() {
    el.data.value = state.link;
    setSegmented("#mode", state.mode);
    el.modeLink.hidden = state.mode !== "link";
    el.modeVcard.hidden = state.mode !== "vcard";
    for (const k of VC_FIELDS) $("#vc" + k[0].toUpperCase() + k.slice(1)).value = state.vcard[k];
    refreshData();
    setSegmented('#shape', state.shape);
    setSegmented('#corner', state.corner);
    setSegmented('#colorMode', state.colorMode);
    for (const id of ['color1', 'color2', 'bg', 'frameColor', 'frameText']) setColorInput(id, state[id]);
    el.color2Wrap.hidden = state.colorMode !== 'gradient';
    el.gradAngleWrap.hidden = state.colorMode !== 'gradient';
    el.gradAngle.value = state.gradAngle;
    el.gradAngleOut.textContent = `${state.gradAngle}°`;
    el.logoSize.value = state.logoSize;
    el.logoMargin.value = state.logoMargin;
    el.logoOpts.hidden = !state.logo;
    el.logoHint.hidden = !!state.logo;
    el.logoThumb.hidden = !state.logo;
    el.logoLabel.textContent = state.logo ? 'Cambia logo' : 'Carica logo';
    if (state.logo) el.logoImg.src = state.logo;
    el.frameOn.checked = state.frameOn;
    el.frameOpts.hidden = !state.frameOn;
    el.cta.value = state.cta;
    el.radius.value = state.radius;
    el.radiusOut.textContent = state.radius;
    el.frameW.value = state.frameW;
    el.frameWOut.textContent = `${state.frameW}%`;
    setSegmented("#pngSize", String(state.pngSize));
    updatePngSizeOut();
    updateContrast();
    updateLogoNote();
  }

  function setSegmented(sel, value) {
    $$(`${sel} .seg`).forEach((b) => {
      const on = b.dataset.value === value;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-checked', String(on));
    });
  }
  function setColorInput(id, value) {
    const input = el[id];
    input.value = value;
    input.parentElement.querySelector('.swatch-chip').style.setProperty('--c', value);
    input.parentElement.querySelector('code').textContent = value;
  }

  // ---------- Render ----------
  let renderToken = 0;
  let currentSvg = '';

  async function render() {
    const token = ++renderToken;
    setExport(false);

    if (!state.data.trim()) {
      setStatus('fail', 'Scrivi qualcosa da codificare');
      el.meta.textContent = '—';
      return;
    }

    setBusy(true);
    setStatus('busy', 'Genero e verifico…');
    try {
      const { svg: inner, modules } = await buildQR();
      if (token !== renderToken) return;
      currentSvg = compose(inner, modules);
      el.stage.innerHTML = currentSvg;
      const compositeW = +el.stage.querySelector("svg").getAttribute("width");
      const minCm = ((modules * MM_PER_MODULE) / 10).toFixed(1).replace(".", ",");
      el.meta.textContent = `${modules}×${modules} moduli · ${state.data.length} caratteri · stampa il QR ad almeno ${minCm} cm`;

      const result = await verify(currentSvg, modules, compositeW);
      if (token !== renderToken) return;
      applyVerdict(result);
    } catch (e) {
      console.error(e);
      setStatus('fail', 'Errore nella generazione', e && e.message ? e.message : String(e));
    } finally {
      if (token === renderToken) setBusy(false);
    }
  }
  const scheduleRender = debounce(render, 160);

  // ---------- Export ----------
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  function fileBase() {
    let base = "qr";
    if (state.mode === "vcard") {
      base = [state.vcard.nome, state.vcard.cognome].join(" ").trim() || state.vcard.azienda;
      return `inquadrami-${slug(base) || "contatto"}`;
    }
    try { base = new URL(state.data).hostname.replace(/^www\./, ''); } catch (_) { base = slug(state.data).slice(0, 32) || 'qr'; }
    return `inquadrami-${slug(base) || 'qr'}`;
  }

  el.dlSvg.addEventListener('click', () => {
    const blob = new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + currentSvg], { type: 'image/svg+xml;charset=utf-8' });
    download(blob, `${fileBase()}.svg`);
  });
  el.dlPng.addEventListener('click', async () => {
    el.dlPng.disabled = true;
    try {
      if (fontCss === null) await loadFont();
      const canvas = await rasterize(currentSvg, state.pngSize, true);
      canvas.toBlob((b) => download(b, `${fileBase()}-${state.pngSize}.png`), "image/png");
    } finally {
      el.dlPng.disabled = false;
    }
  });

  // ---------- Eventi ----------
  el.data.addEventListener("input", () => { state.link = el.data.value; refreshData(); scheduleRender(); });

  $("#mode").addEventListener("click", (e) => {
    const b = e.target.closest(".seg");
    if (!b) return;
    state.mode = b.dataset.value;
    setSegmented("#mode", state.mode);
    el.modeLink.hidden = state.mode !== "link";
    el.modeVcard.hidden = state.mode !== "vcard";
    refreshData();
    scheduleRender();
  });

  for (const k of VC_FIELDS) {
    const input = $("#vc" + k[0].toUpperCase() + k.slice(1));
    input.addEventListener("input", () => { state.vcard[k] = input.value; refreshData(); scheduleRender(); });
  }

  for (const [sel, key] of [['#shape', 'shape'], ['#corner', 'corner'], ['#colorMode', 'colorMode']]) {
    $(sel).addEventListener('click', (e) => {
      const b = e.target.closest('.seg');
      if (!b) return;
      state[key] = b.dataset.value;
      setSegmented(sel, state[key]);
      if (key === 'colorMode') {
        el.color2Wrap.hidden = state.colorMode !== 'gradient';
        el.gradAngleWrap.hidden = state.colorMode !== 'gradient';
        updateContrast();
      }
      scheduleRender();
    });
  }

  for (const id of ['color1', 'color2', 'bg', 'frameColor', 'frameText']) {
    el[id].addEventListener('input', () => {
      state[id] = el[id].value;
      setColorInput(id, state[id]);
      updateContrast();
      scheduleRender();
    });
  }

  el.gradAngle.addEventListener('input', () => {
    state.gradAngle = +el.gradAngle.value;
    el.gradAngleOut.textContent = `${state.gradAngle}°`;
    scheduleRender();
  });

  el.logoFile.addEventListener('change', async () => {
    const file = el.logoFile.files[0];
    if (!file) return;
    try {
      state.logo = await readLogo(file);
      syncUI();
      scheduleRender();
    } catch (e) {
      setStatus('fail', 'Logo non leggibile', 'Prova con un PNG, JPG, WebP o SVG.');
    } finally {
      el.logoFile.value = '';
    }
  });
  el.logoRemove.addEventListener('click', () => { state.logo = null; syncUI(); scheduleRender(); });
  el.logoSize.addEventListener('input', () => { state.logoSize = +el.logoSize.value; updateLogoNote(); scheduleRender(); });
  el.logoMargin.addEventListener('input', () => { state.logoMargin = +el.logoMargin.value; updateLogoNote(); scheduleRender(); });

  el.frameOn.addEventListener('change', () => { state.frameOn = el.frameOn.checked; el.frameOpts.hidden = !state.frameOn; scheduleRender(); });
  el.cta.addEventListener('input', () => { state.cta = el.cta.value; scheduleRender(); });
  el.frameW.addEventListener("input", () => { state.frameW = +el.frameW.value; el.frameWOut.textContent = `${state.frameW}%`; scheduleRender(); });
  el.radius.addEventListener('input', () => { state.radius = +el.radius.value; el.radiusOut.textContent = state.radius; scheduleRender(); });

  $("#pngSize").addEventListener("click", (e) => {
    const b = e.target.closest(".seg");
    if (!b) return;
    state.pngSize = +b.dataset.value;
    setSegmented("#pngSize", b.dataset.value);
    updatePngSizeOut();
  });

  el.reset.addEventListener('click', () => { state = { ...DEFAULTS, vcard: { ...DEFAULTS.vcard } }; syncUI(); render(); });

  // Legge il logo come data URL; i raster vengono ridotti a 1000px: nel PNG a 2048px il logo
  // arriva al massimo a ~700px, quindi non viene mai ingrandito.
  function readLogo(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => {
        const url = reader.result;
        if (file.type === 'image/svg+xml') return resolve(url);
        const img = new Image();
        img.onload = () => {
          const max = 1000;
          const k = Math.min(1, max / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * k);
          c.height = Math.round(img.height * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/png'));
        };
        img.onerror = () => reject(new Error('immagine non valida'));
        img.src = url;
      };
      reader.readAsDataURL(file);
    });
  }

  // ---------- Avvio ----------
  syncUI();
  render();
  loadFont(); // in background: serve solo al PNG
})();
