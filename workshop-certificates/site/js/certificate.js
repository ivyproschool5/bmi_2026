/* Ivy Workshop Certificates - certificate, badge and QR rendering, plus share helpers.
 * Everything is drawn on <canvas> in the browser, so no server is needed to make images. */
(function () {
  'use strict';
  var U = window.IvyUtil;
  var cfg = U.cfg;

  var C = { sky: '#1a98cb', deep: '#0b5394', navy: '#092f55', amber: '#f7a61b', ink: '#17324b', muted: '#5c6f83', line: '#dbe5ed' };
  var HEAD = 'Montserrat, "Segoe UI", Arial, sans-serif';
  var BODY = 'Poppins, "Segoe UI", Arial, sans-serif';

  /* ---------------- loading ---------------- */
  var fontsReady = null;
  function ensureFonts() {
    if (fontsReady) return fontsReady;
    if (!document.fonts || !document.fonts.load) return (fontsReady = Promise.resolve());
    var specs = ['800 100px Montserrat', '700 100px Montserrat', '600 40px Montserrat', '400 40px Poppins', '500 40px Poppins', '600 40px Poppins'];
    var all = Promise.all(specs.map(function (s) { return document.fonts.load(s).catch(function () {}); }));
    fontsReady = Promise.race([all, new Promise(function (r) { setTimeout(r, 4000); })]);
    return fontsReady;
  }

  var imgCache = {};
  function loadImage(src) {
    if (!src) return Promise.resolve(null);
    if (imgCache[src]) return imgCache[src];
    imgCache[src] = new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
    return imgCache[src];
  }

  /* ---------------- QR ---------------- */
  function qrMatrix(text) {
    var qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr;
  }

  function drawQR(ctx, text, x, y, size, dark, light) {
    var qr = qrMatrix(text);
    var n = qr.getModuleCount();
    var cell = size / n;
    ctx.fillStyle = light || '#fff';
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = dark || C.navy;
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (qr.isDark(r, c)) ctx.fillRect(Math.floor(x + c * cell), Math.floor(y + r * cell), Math.ceil(cell), Math.ceil(cell));
      }
    }
  }

  /** QR as a canvas with a white quiet zone. */
  function qrCanvas(text, size, dark) {
    var cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    var ctx = cv.getContext('2d');
    var pad = Math.round(size * 0.07);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);
    drawQR(ctx, text, pad, pad, size - pad * 2, dark || '#000');
    return cv;
  }

  /* ---------------- text helpers ---------------- */
  function font(weight, size, family) { return weight + ' ' + size + 'px ' + family; }

  function fitSize(ctx, text, weight, family, maxSize, minSize, maxWidth) {
    var s = maxSize;
    ctx.font = font(weight, s, family);
    while (s > minSize && ctx.measureText(text).width > maxWidth) {
      s -= 2;
      ctx.font = font(weight, s, family);
    }
    return s;
  }

  function wrap(ctx, text, maxWidth) {
    var words = String(text).split(/\s+/);
    var lines = [];
    var line = '';
    words.forEach(function (w) {
      var test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; }
      else line = test;
    });
    if (line) lines.push(line);
    return lines;
  }

  /** Wraps text, shrinking the font until it fits in maxLines. Returns { size, lines }. */
  function fitWrap(ctx, text, weight, family, maxSize, minSize, maxWidth, maxLines) {
    var s = maxSize;
    var lines;
    do {
      ctx.font = font(weight, s, family);
      lines = wrap(ctx, text, maxWidth);
      if (lines.length <= maxLines) break;
      s -= 2;
    } while (s >= minSize);
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      var last = lines[maxLines - 1];
      while (ctx.measureText(last + '...').width > maxWidth && last.length) last = last.slice(0, -1);
      lines[maxLines - 1] = last + '...';
    }
    return { size: s, lines: lines };
  }

  function spacedWidth(ctx, text, spacing) {
    var w = 0;
    for (var i = 0; i < text.length; i++) w += ctx.measureText(text[i]).width;
    return w + spacing * (text.length - 1);
  }

  function drawSpaced(ctx, text, x, y, spacing, align) {
    var w = spacedWidth(ctx, text, spacing);
    var cx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    var prev = ctx.textAlign;
    ctx.textAlign = 'left';
    for (var i = 0; i < text.length; i++) {
      ctx.fillText(text[i], cx, y);
      cx += ctx.measureText(text[i]).width + spacing;
    }
    ctx.textAlign = prev;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function hostLabel() {
    return U.siteBase().replace(/^https?:\/\//, '');
  }

  function footerLine() {
    return 'ivyproschool.com   ·   Since 2008   ·   37,500+ alumni   ·   Recognized by MeitY';
  }

  /* ---------------- certificate (A4 landscape) ---------------- */
  var CW = 2400, CH = 1697;

  function renderCertificate(cert) {
    return Promise.all([ensureFonts(), loadImage('assets/ivy-logo.png'), loadImage(cfg.SIGNATURE_IMAGE)]).then(function (res) {
      var logo = res[1], sig = res[2];
      var cv = document.createElement('canvas');
      cv.width = CW; cv.height = CH;
      var ctx = cv.getContext('2d');
      var achievement = cert.type === 'achievement';
      ctx.textBaseline = 'alphabetic';

      // Ground and frames
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, CW, CH);
      ctx.strokeStyle = C.deep; ctx.lineWidth = 14;
      ctx.strokeRect(36, 36, CW - 72, CH - 72);
      ctx.strokeStyle = C.sky; ctx.lineWidth = 3;
      ctx.strokeRect(66, 66, CW - 132, CH - 132);

      // Logo-inspired bars, top left
      [[C.sky, 0], [C.amber, 42], [C.sky, 84]].forEach(function (b) {
        ctx.fillStyle = b[0];
        ctx.fillRect(130 + b[1], 112, 30, 128);
      });
      ctx.fillStyle = C.muted;
      ctx.font = font(600, 24, HEAD);
      drawSpaced(ctx, 'AI AND DATA SCIENCE TRAINING', 262, 166, 4, 'left');
      drawSpaced(ctx, 'SINCE 2008', 262, 208, 4, 'left');

      // Logo, top right (never stretched)
      if (logo) {
        var lh = 220, lw = lh * logo.naturalWidth / logo.naturalHeight;
        ctx.drawImage(logo, CW - 130 - lw, 100, lw, lh);
      }

      // Title
      ctx.textAlign = 'center';
      ctx.fillStyle = C.deep;
      ctx.font = font(800, 112, HEAD);
      drawSpaced(ctx, 'CERTIFICATE', CW / 2, 410, 18, 'center');
      ctx.fillStyle = C.sky;
      ctx.font = font(700, 42, HEAD);
      drawSpaced(ctx, achievement ? 'OF ACHIEVEMENT' : 'OF PARTICIPATION', CW / 2, 486, 14, 'center');
      ctx.fillStyle = C.amber;
      ctx.fillRect(CW / 2 - 60, 520, 120, 8);

      // Recipient
      ctx.fillStyle = C.muted;
      ctx.font = font(400, 40, BODY);
      ctx.fillText('This is to certify that', CW / 2, 650);

      var nameSize = fitSize(ctx, cert.name, 700, HEAD, 124, 60, 1800);
      ctx.font = font(700, nameSize, HEAD);
      ctx.fillStyle = C.navy;
      ctx.fillText(cert.name, CW / 2, 800);
      var nameW = Math.max(ctx.measureText(cert.name).width + 140, 900);
      ctx.strokeStyle = C.line; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(CW / 2 - nameW / 2, 842); ctx.lineTo(CW / 2 + nameW / 2, 842); ctx.stroke();

      ctx.fillStyle = C.muted;
      ctx.font = font(400, 40, BODY);
      ctx.fillText(achievement ? 'has successfully completed the post-training assessment for' : 'has participated in', CW / 2, 928);

      // Program
      var prog = fitWrap(ctx, cert.programName, 700, HEAD, 74, 46, 1900, 2);
      ctx.font = font(700, prog.size, HEAD);
      ctx.fillStyle = C.deep;
      var py = 1032;
      prog.lines.forEach(function (l, i) { ctx.fillText(l, CW / 2, py + i * prog.size * 1.2); });
      var afterProg = py + (prog.lines.length - 1) * prog.size * 1.2;

      // Meta line
      var meta = [];
      if (cert.clientName) meta.push('Delivered for ' + cert.clientName);
      if (cert.duration) meta.push(cert.duration);
      meta.push(U.formatDate(cert.date));
      var metaText = meta.join('   ·   ');
      fitSize(ctx, metaText, 500, BODY, 36, 24, 1900);
      ctx.fillStyle = C.ink;
      ctx.fillText(metaText, CW / 2, afterProg + 86);

      // Sign-off blocks
      function signBlock(cx, name, title, image) {
        ctx.textAlign = 'center';
        if (image) {
          var sh = 110, sw = sh * image.naturalWidth / image.naturalHeight;
          ctx.drawImage(image, cx - sw / 2, 1320, sw, sh);
          ctx.strokeStyle = C.navy; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(cx - 200, 1440); ctx.lineTo(cx + 200, 1440); ctx.stroke();
        } else {
          ctx.fillStyle = C.amber;
          ctx.fillRect(cx - 40, 1404, 80, 6);
        }
        ctx.fillStyle = C.navy;
        fitSize(ctx, name, 700, HEAD, 36, 24, 440);
        ctx.fillText(name, cx, 1488);
        ctx.fillStyle = C.muted;
        fitSize(ctx, title, 400, BODY, 26, 18, 460);
        ctx.fillText(title, cx, 1530);
      }
      signBlock(520, cfg.SIGNATORY_NAME || 'Prateek Agrawal', cfg.SIGNATORY_TITLE || 'Founder, Ivy Professional School', sig);
      if (cert.trainer) signBlock(1080, cert.trainer, 'Workshop Trainer', null);

      // Verification block, bottom right
      var qs = 210, qx = CW - 130 - qs, qy = 1300;
      drawQR(ctx, U.verifyUrl(cert.id), qx, qy, qs, C.navy, '#fff');
      ctx.textAlign = 'right';
      var tx = qx - 30;
      ctx.fillStyle = C.navy; ctx.font = font(700, 28, HEAD);
      ctx.fillText('Verify this certificate', tx, 1352);
      ctx.fillStyle = C.ink; ctx.font = font(500, 26, BODY);
      ctx.fillText('ID: ' + cert.id, tx, 1396);
      ctx.fillStyle = C.muted; ctx.font = font(400, 22, BODY);
      fitSize(ctx, hostLabel(), 400, BODY, 22, 16, 520);
      ctx.fillText(hostLabel(), tx, 1436);
      ctx.font = font(400, 22, BODY);
      ctx.fillText('Issued ' + U.formatDate(cert.issuedAt), tx, 1474);

      // Footer band
      ctx.fillStyle = C.deep;
      ctx.fillRect(67.5, 1562, CW - 135, 67.5);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.font = font(500, 26, BODY);
      ctx.fillText(footerLine(), CW / 2, 1606);

      return cv;
    });
  }

  /* ---------------- square badge (1080 x 1080) ---------------- */
  function renderBadge(cert) {
    return Promise.all([ensureFonts(), loadImage('assets/ivy-logo.png')]).then(function (res) {
      var logo = res[1];
      var S = 1080;
      var cv = document.createElement('canvas');
      cv.width = S; cv.height = S;
      var ctx = cv.getContext('2d');
      var achievement = cert.type === 'achievement';

      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, S, S);
      ctx.fillStyle = C.sky; ctx.fillRect(0, 0, S / 3, 16);
      ctx.fillStyle = C.amber; ctx.fillRect(S / 3, 0, S / 3, 16);
      ctx.fillStyle = C.sky; ctx.fillRect(2 * S / 3, 0, S / 3, 16);

      if (logo) {
        var lh = 170, lw = lh * logo.naturalWidth / logo.naturalHeight;
        ctx.drawImage(logo, S - 80 - lw, 64, lw, lh);
      }
      ctx.textAlign = 'left';
      ctx.fillStyle = C.sky;
      ctx.font = font(700, 26, HEAD);
      drawSpaced(ctx, 'VERIFIED', 80, 130, 8, 'left');
      ctx.fillStyle = C.navy;
      ctx.font = font(800, 46, HEAD);
      ctx.fillText('Certificate of', 80, 192);
      ctx.fillText(achievement ? 'Achievement' : 'Participation', 80, 244);

      // Panel
      var px = 80, py = 300, pw = S - 160, ph = 420;
      var g = ctx.createLinearGradient(px, py, px + pw, py + ph);
      g.addColorStop(0, '#083b6d'); g.addColorStop(.6, C.deep); g.addColorStop(1, '#087ca8');
      ctx.fillStyle = g;
      roundRect(ctx, px, py, pw, ph, 32);
      ctx.fill();

      ctx.textAlign = 'center';
      ctx.fillStyle = C.amber;
      ctx.font = font(700, 26, HEAD);
      drawSpaced(ctx, 'IVY PROFESSIONAL SCHOOL', S / 2, py + 76, 8, 'center');
      var pr = fitWrap(ctx, cert.programName, 800, HEAD, 64, 36, pw - 120, 3);
      ctx.font = font(800, pr.size, HEAD);
      ctx.fillStyle = '#fff';
      var blockH = pr.lines.length * pr.size * 1.18;
      var startY = py + 90 + (ph - 170 - blockH) / 2 + pr.size;
      pr.lines.forEach(function (l, i) { ctx.fillText(l, S / 2, startY + i * pr.size * 1.18); });
      var meta = [U.formatDate(cert.date)];
      if (cert.duration) meta.unshift(cert.duration);
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.font = font(500, 28, BODY);
      ctx.fillText(meta.join('  ·  '), S / 2, py + ph - 48);

      // Recipient
      ctx.fillStyle = C.muted;
      ctx.font = font(400, 28, BODY);
      ctx.fillText(achievement ? 'Awarded to' : 'Presented to', S / 2, 800);
      ctx.fillStyle = C.navy;
      fitSize(ctx, cert.name, 700, HEAD, 64, 34, S - 160);
      ctx.fillText(cert.name, S / 2, 872);
      if (cert.clientName) {
        ctx.fillStyle = C.ink;
        fitSize(ctx, 'Delivered for ' + cert.clientName, 500, BODY, 28, 20, S - 160);
        ctx.fillText('Delivered for ' + cert.clientName, S / 2, 922);
      }

      ctx.strokeStyle = C.line; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(80, 966); ctx.lineTo(S - 80, 966); ctx.stroke();
      ctx.fillStyle = C.muted;
      ctx.font = font(400, 24, BODY);
      ctx.textAlign = 'left';
      ctx.fillText('ID ' + cert.id, 80, 1016);
      ctx.textAlign = 'right';
      fitSize(ctx, hostLabel(), 400, BODY, 24, 16, 560);
      ctx.fillText(hostLabel(), S - 80, 1016);
      return cv;
    });
  }

  /* ---------------- presenter slide with QR (1920 x 1080) ---------------- */
  function renderQrSlide(ws, url) {
    return Promise.all([ensureFonts(), loadImage('assets/ivy-logo.png')]).then(function (res) {
      var logo = res[1];
      var W = 1920, H = 1080;
      var cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      var ctx = cv.getContext('2d');
      var g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#083b6d'); g.addColorStop(.58, C.deep); g.addColorStop(1, '#087ca8');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

      if (logo) {
        var lh = 120, lw = lh * logo.naturalWidth / logo.naturalHeight;
        ctx.fillStyle = '#fff';
        roundRect(ctx, W - 100 - lw - 24, 60, lw + 48, lh + 32, 18); ctx.fill();
        ctx.drawImage(logo, W - 100 - lw, 76, lw, lh);
      }
      ctx.textAlign = 'left';
      ctx.fillStyle = C.amber;
      ctx.font = font(700, 30, HEAD);
      drawSpaced(ctx, 'BEFORE YOU LEAVE', 110, 260, 8, 'left');
      ctx.fillStyle = '#fff';
      ctx.font = font(800, 76, HEAD);
      ['Scan to take the', 'assessment and get', 'your certificate'].forEach(function (l, i) { ctx.fillText(l, 110, 360 + i * 92); });
      var pr = fitWrap(ctx, ws.programName, 600, HEAD, 40, 26, 900, 2);
      ctx.font = font(600, pr.size, HEAD);
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      pr.lines.forEach(function (l, i) { ctx.fillText(l, 110, 690 + i * pr.size * 1.25); });
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      ctx.font = font(400, 30, BODY);
      ctx.fillText('About 5 minutes  ·  Download or share on LinkedIn', 110, 820);
      ctx.fillText('Or open ' + U.siteBase().replace(/^https?:\/\//, '') + ' and enter code', 110, 880);
      ctx.fillStyle = C.amber;
      ctx.font = font(800, 64, HEAD);
      drawSpaced(ctx, ws.code, 110, 966, 10, 'left');

      var qs = 620, qx = W - 110 - qs, qy = 270;
      ctx.fillStyle = '#fff';
      roundRect(ctx, qx - 30, qy - 30, qs + 60, qs + 60, 28); ctx.fill();
      drawQR(ctx, url, qx, qy, qs, '#000', '#fff');
      return cv;
    });
  }

  /* ---------------- downloads ---------------- */
  function slug(s) { return String(s || '').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'participant'; }

  function fileBase(cert) { return 'Ivy-Certificate-' + slug(cert.name) + '-' + cert.id; }

  function canvasBlob(cv) {
    return new Promise(function (resolve) { cv.toBlob(function (b) { resolve(b); }, 'image/png'); });
  }

  function saveBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function downloadPng(cv, filename) {
    return canvasBlob(cv).then(function (b) { saveBlob(b, filename); return b; });
  }

  function downloadPdf(cv, filename) {
    var PDF = window.jspdf && window.jspdf.jsPDF;
    if (!PDF) return Promise.reject(new Error('PDF library failed to load'));
    var doc = new PDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
    doc.setProperties({ title: filename.replace(/\.pdf$/, ''), author: 'Ivy Professional School', creator: 'Ivy Professional School' });
    doc.addImage(cv.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, 297, 210);
    doc.save(filename);
    return Promise.resolve();
  }

  /* ---------------- LinkedIn ---------------- */
  function shareText(cert, takeaway) {
    var forClient = cert.clientName ? ' as part of a learning programme for ' + cert.clientName : '';
    var lines = [];
    if (cert.type === 'achievement') {
      lines.push('I have completed "' + cert.programName + '" with Ivy Professional School' + forClient + ' and passed the post-training assessment.');
    } else {
      lines.push('I attended "' + cert.programName + '" with Ivy Professional School' + forClient + '.');
    }
    if (takeaway) lines.push('One thing I will apply at work: ' + takeaway);
    lines.push('Certificate: ' + U.verifyUrl(cert.id));
    lines.push(cfg.HASHTAGS || '#AI #IvyProfessionalSchool');
    return lines.join('\n\n');
  }

  function linkedinAddUrl(cert) {
    var p = new URLSearchParams();
    p.set('startTask', 'CERTIFICATION_NAME');
    p.set('name', cert.programName + (cert.type === 'achievement' ? '' : ' (Participation)'));
    if (cfg.LINKEDIN_ORG_ID) p.set('organizationId', cfg.LINKEDIN_ORG_ID);
    else p.set('organizationName', cfg.LINKEDIN_ORG_NAME || 'Ivy Professional School');
    var d = (cert.issuedAt || cert.date || '').split('-');
    if (d.length === 3) { p.set('issueYear', d[0]); p.set('issueMonth', String(Number(d[1]))); }
    p.set('certUrl', U.verifyUrl(cert.id));
    p.set('certId', cert.id);
    return 'https://www.linkedin.com/profile/add?' + p.toString();
  }

  function linkedinPostUrl(text) {
    return 'https://www.linkedin.com/feed/?shareActive=true&text=' + encodeURIComponent(text);
  }

  function linkedinLinkShareUrl(url) {
    return 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(url);
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }

  window.IvyCert = {
    renderCertificate: renderCertificate,
    renderBadge: renderBadge,
    renderQrSlide: renderQrSlide,
    qrCanvas: qrCanvas,
    canvasBlob: canvasBlob,
    downloadPng: downloadPng,
    downloadPdf: downloadPdf,
    saveBlob: saveBlob,
    fileBase: fileBase,
    shareText: shareText,
    linkedinAddUrl: linkedinAddUrl,
    linkedinPostUrl: linkedinPostUrl,
    linkedinLinkShareUrl: linkedinLinkShareUrl,
    copyText: copyText
  };
})();
