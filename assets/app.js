(function(){
  'use strict';

  function $id(id){ return document.getElementById(id); }
  function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }

  function panoAssetForFull(full){
    if (!full) return null;
    var i = full.lastIndexOf('/full/');
    if (i < 0) return full;
    var dir = full.slice(0, i + 1);
    var name = full.slice(i + 6);
    var dot = name.lastIndexOf('.');
    var stem = dot > 0 ? name.slice(0, dot) : name;
    return dir + 'pano/' + stem + '.jpg';
  }

  function displayName(src){
    if (!src) return '-';
    if (src.indexOf('blob:') === 0) return currentFileName || '本地文件';
    try {
      var u = new URL(src, location.href);
      return decodeURIComponent(u.pathname.split('/').pop() || src);
    } catch (e) { return src; }
  }

  function extOf(src){
    var n = displayName(src) || src;
    var i = n.lastIndexOf('.');
    return i >= 0 ? n.slice(i + 1).toLowerCase() : 'jpg';
  }


  // ---- 4K / 6K resolution toggle ----
  var resButtons = document.querySelectorAll('.res-toggle-btn');
  var sampleSections = document.querySelectorAll('.sample');
  function setResolution(res){
    resButtons.forEach(function(b){
      b.classList.toggle('active', b.getAttribute('data-res') === res);
    });
    sampleSections.forEach(function(sec){
      var n = parseInt(sec.id.replace(/\D/g, ''), 10);
      var is4k = n <= 25;
      sec.classList.toggle('hidden', res === '4K' ? !is4k : is4k);
    });
  }
  resButtons.forEach(function(b){
    b.addEventListener('click', function(){
      setResolution(b.getAttribute('data-res'));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
  setResolution('4K');

  // ---- Add comparison shortcuts beside the panorama badges on top cells ----
  function openCompareWidget(leftFull, leftCaption, rightFull, rightCaption){
    openCompare(leftFull, leftCaption || '', rightFull, rightCaption || '', 50);
  }

  function makeActionButton(label, leftFull, leftCaption, rightFull, rightCaption){
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'cell-action';
    b.textContent = label;
    b.addEventListener('click', function(e){
      e.stopPropagation();
      openCompareWidget(leftFull, leftCaption, rightFull, rightCaption);
    });
    return b;
  }

  document.querySelectorAll('.sample').forEach(function(sample){
    var topGrid = sample.querySelector('.grid3');
    if (!topGrid) return;
    var topCells = topGrid.querySelectorAll('.cell');
    if (topCells.length < 3) return;
    function cellMediaBy(pat){
      for (var i = 0; i < topCells.length; i++){
        var media = topCells[i].querySelector('.cell-media');
        var full = media ? media.getAttribute('data-full') : '';
        if (full && pat.test(full)) return media;
      }
      return null;
    }
    var newMedia = cellMediaBy(/col3_/);
    var oldMedia = cellMediaBy(/col2_/);
    var origMedia = cellMediaBy(/orig_/);
    function mediaFull(media){ return media ? media.getAttribute('data-full') : ''; }
    function mediaCaption(media){ return media ? (media.getAttribute('data-caption') || '') : ''; }
    function addActions(media, list){
      if (!media) return;
      var badge = media.querySelector('.pan-badge');
      var wrapper = media.querySelector('.cell-actions');
      if (!wrapper){ wrapper = document.createElement('div'); wrapper.className = 'cell-actions'; media.appendChild(wrapper); }
      if (badge && badge.parentNode !== wrapper) wrapper.appendChild(badge);
      list.forEach(function(item){
        wrapper.appendChild(makeActionButton(item.label, item.left, item.leftCaption, item.right, item.rightCaption));
      });
    }
    addActions(newMedia, [
      { label: '原图对比', left: mediaFull(newMedia), leftCaption: mediaCaption(newMedia), right: mediaFull(origMedia), rightCaption: mediaCaption(origMedia) },
      { label: '旧效果对比', left: mediaFull(newMedia), leftCaption: mediaCaption(newMedia), right: mediaFull(oldMedia), rightCaption: mediaCaption(oldMedia) }
    ]);
    addActions(oldMedia, [
      { label: '原图对比', left: mediaFull(oldMedia), leftCaption: mediaCaption(oldMedia), right: mediaFull(origMedia), rightCaption: mediaCaption(origMedia) }
    ]);
  });

  // ---- Panorama viewer ----  // ---- Panorama viewer ----
  var panoEl = $id('pano');
  var viewer = $id('pano-viewer');
  var panoSide = document.querySelector('.pano-side');
  var panoDrop = $id('pano-drop');
  var panoFile = $id('pano-file');
  var panoUrl = $id('pano-url');
  var panoUrlClear = $id('pano-url-clear');
  var panoUrlLoad = $id('pano-url-load');
  var panoDownload = $id('pano-download');
  var panoSource = $id('pano-source');
  var panoSize = $id('pano-size');
  var panoZoomIn = $id('pano-zoom-in');
  var panoZoomOut = $id('pano-zoom-out');
  var panoFullscreen = $id('pano-fullscreen');
  var panoClose = $id('pano-close');
  var panoCode = $id('pano-code');
  var panoCodeCopy = $id('pano-code-copy');
  var panoCodeApply = $id('pano-code-apply');
  var panoEmpty = $id('pano-empty');
  var panoToggle = $id('pano-toggle');

  var scene, camera, renderer, sphere, raf;
  var currentObjectUrl = null;
  var currentFileName = '';
  var currentPanoSrc = null;
  var currentFullSrc = null;
  var lon = 0, lat = 0, targetLon = 0, targetLat = 0;
  var fov = 75, targetFov = 75;
  var dragState = null;
  var codeEditing = false;
  var sidebarCollapsed = false;

  function fmt(n){
    var r = Math.round(n * 10) / 10;
    if (Object.is(r, -0)) r = 0;
    return String(r);
  }
  function viewCode(){
    return fmt(lon) + ',' + fmt(lat) + ',' + fmt(fov);
  }
  function tickCode(){
    if (!codeEditing && panoCode) panoCode.value = viewCode();
  }

  function clearTexture(){
    if (sphere && sphere.material){
      sphere.material.map = null;
      sphere.material.color.set(0x101214);
      sphere.material.needsUpdate = true;
    }
    if (panoEmpty) panoEmpty.classList.remove('hide');
    if (panoSize) panoSize.textContent = '-';
  }

  function resizeViewer(){
    if (!renderer || !viewer) return;
    var w = viewer.clientWidth || 1;
    var h = viewer.clientHeight || 1;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }

  function animate(){
    raf = requestAnimationFrame(animate);
    if (!panoEl.classList.contains('open') || !renderer || !camera) return;
    lon += (targetLon - lon) * 0.18;
    lat += (targetLat - lat) * 0.18;
    fov += (targetFov - fov) * 0.18;
    camera.fov = fov;
    camera.updateProjectionMatrix();
    var phi = THREE.MathUtils.degToRad(90 - lat);
    var theta = THREE.MathUtils.degToRad(lon);
    camera.position.set(0, 0, 0);
    camera.lookAt(
      500 * Math.sin(phi) * Math.cos(theta),
      500 * Math.cos(phi),
      500 * Math.sin(phi) * Math.sin(theta)
    );
    renderer.render(scene, camera);
    tickCode();
  }

  function loadPano(src){
    if (!sphere) return;
    panoEmpty.classList.remove('hide');
    var loader = new THREE.TextureLoader();
    if (/^https?:/i.test(src)) loader.setCrossOrigin('anonymous');
    loader.load(src, function(tex){
      if (currentPanoSrc !== src) return;
      if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
      else if ('encoding' in tex) tex.encoding = THREE.sRGBEncoding;
      sphere.material.map = tex;
      sphere.material.color.set(0xffffff);
      sphere.material.needsUpdate = true;
      panoEmpty.classList.add('hide');
      var img = tex.image;
      panoSize.textContent = (img && img.width) ? (img.width + ' × ' + img.height) : '-';
      panoCode.value = viewCode();
    }, undefined, function(){
      if (currentPanoSrc === src){
        panoEmpty.classList.remove('hide');
        panoSize.textContent = '-';
      }
    });
  }

  function openPano(panoSrc, fullSrc, caption, sourceName){
    if (!panoEl || !panoSrc) return;
    if (panoSrc.indexOf('blob:') !== 0 && currentObjectUrl && currentObjectUrl !== panoSrc){
      URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = null;
      currentFileName = '';
    }
    currentPanoSrc = panoSrc;
    currentFullSrc = fullSrc || panoSrc;
    clearTexture();
    panoEl.classList.add('is-collapsed');
    sidebarCollapsed = true;
    panoToggle.textContent = '›';
    panoEl.classList.add('open');
    document.body.classList.add('pano-lock');
    panoSource.textContent = sourceName || displayName(panoSrc);
    panoCode.value = '';
    targetLon = 0; targetLat = 0; targetFov = 75;
    lon = 0; lat = 0; fov = 75;
    resizeViewer();
    setTimeout(resizeViewer, 260);
    loadPano(panoSrc);
  }

  function closePano(){
    if (!panoEl.classList.contains('open')) return;
    panoEl.classList.remove('open');
    document.body.classList.remove('pano-lock');
    if (currentObjectUrl){
      URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = null;
    }
    currentFileName = '';
    currentPanoSrc = null;
    currentFullSrc = null;
    clearTexture();
  }

  function loadFile(file){
    if (!file) return;
    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    currentFileName = file.name;
    currentObjectUrl = URL.createObjectURL(file);
    openPano(currentObjectUrl, currentObjectUrl, '', file.name);
  }

  function bindControls(){
    panoDrop.addEventListener('click', function(){ panoFile.click(); });
    panoFile.addEventListener('change', function(){ loadFile(this.files && this.files[0]); });
    ['dragenter','dragover'].forEach(function(ev){
      panoDrop.addEventListener(ev, function(e){ e.preventDefault(); e.stopPropagation(); panoDrop.classList.add('drag'); });
    });
    ['dragleave','drop'].forEach(function(ev){
      panoDrop.addEventListener(ev, function(e){ e.preventDefault(); e.stopPropagation(); panoDrop.classList.remove('drag'); });
    });
    panoDrop.addEventListener('drop', function(e){
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadFile(f);
    });

    panoUrl.addEventListener('focus', function(){ this.select(); });
    panoUrl.addEventListener('keydown', function(e){ if (e.key === 'Enter') loadUrl(); });
    panoUrlLoad.addEventListener('click', loadUrl);
    panoUrlClear.addEventListener('click', function(){ panoUrl.value = ''; });

    panoDownload.addEventListener('click', downloadOriginal);
    panoZoomIn.addEventListener('click', function(){ targetFov = clamp(targetFov - 10, 20, 100); });
    panoZoomOut.addEventListener('click', function(){ targetFov = clamp(targetFov + 10, 20, 100); });
    panoFullscreen.addEventListener('click', function(){
      var doc = document;
      if (doc.fullscreenElement || doc.webkitFullscreenElement){
        if (doc.exitFullscreen) doc.exitFullscreen();
        else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
      } else {
        if (panoEl.requestFullscreen) panoEl.requestFullscreen();
        else if (panoEl.webkitRequestFullscreen) panoEl.webkitRequestFullscreen();
      }
    });
    panoClose.addEventListener('click', closePano);

    panoCode.addEventListener('focus', function(){ codeEditing = true; this.select(); });
    panoCode.addEventListener('blur', function(){ codeEditing = false; tickCode(); });
    panoCode.addEventListener('keydown', function(e){ if (e.key === 'Enter') applyViewCode(); });
    panoCodeCopy.addEventListener('click', copyViewCode);
    panoCodeApply.addEventListener('click', function(){ applyViewCode(); panoCode.blur(); });

    panoToggle.addEventListener('click', function(){
      sidebarCollapsed = !sidebarCollapsed;
      panoEl.classList.toggle('is-collapsed', sidebarCollapsed);
      panoToggle.textContent = sidebarCollapsed ? '›' : '‹';
      setTimeout(resizeViewer, 220);
    });

    viewer.addEventListener('pointerdown', function(e){
      if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
      dragState = { id: e.pointerId, startX: e.clientX, startY: e.clientY, lon: targetLon, lat: targetLat };
      try { if (viewer.setPointerCapture) viewer.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    viewer.addEventListener('pointermove', function(e){
      if (!dragState || dragState.id !== e.pointerId) return;
      targetLon = dragState.lon + (dragState.startX - e.clientX) * 0.12;
      targetLat = clamp(dragState.lat + (e.clientY - dragState.startY) * 0.12, -85, 85);
    });
    function endDrag(e){
      if (dragState && dragState.id === e.pointerId) dragState = null;
    }
    viewer.addEventListener('pointerup', endDrag);
    viewer.addEventListener('pointercancel', endDrag);
    viewer.addEventListener('wheel', function(e){
      e.preventDefault();
      targetFov = clamp(targetFov + (e.deltaY > 0 ? 4 : -4), 20, 100);
    }, { passive: false });
    viewer.addEventListener('dblclick', function(e){
      e.preventDefault();
      targetLon = 0; targetLat = 0; targetFov = 75;
    });

    document.addEventListener('click', function(e){
      var btn = e.target && e.target.closest ? e.target.closest('button.cmp-open') : null;
      if (btn){
        var full = btn.getAttribute('data-full');
        openPano(full, full, '', btn.getAttribute('data-caption') || '');
        return;
      }
      var badge = e.target && e.target.closest ? e.target.closest('.pan-badge') : null;
      if (badge){
        var bmed = badge.closest('.cell-media');
        if (bmed){
          var bfull = bmed.getAttribute('data-full');
          openPano(bfull, bfull, '', bmed.getAttribute('data-caption') || '');
          return;
        }
      }
      var media = e.target && e.target.closest ? e.target.closest('.cell-media') : null;
      if (media){
        var mfull = media.getAttribute('data-full');
        if (mfull){
          var a = document.createElement('a');
          a.href = mfull;
          a.target = '_blank';
          a.rel = 'noopener';
          document.body.appendChild(a);
          a.click();
          a.remove();
        }
        return;
      }
    });

    document.addEventListener('keydown', function(e){
      if (e.key === 'Escape' && panoEl.classList.contains('open')) closePano();
    });
  }

  function loadUrl(){
    var v = panoUrl.value.trim();
    if (!v) return;
    var m = v.match(/[?&]url=([^&]+)/);
    if (m) v = decodeURIComponent(m[1]);
    panoUrl.value = v;
    openPano(v, v, '', displayName(v));
  }

  function copyViewCode(){
    var txt = viewCode();
    if (navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(txt).catch(function(){ fallbackCopy(txt); });
    } else {
      fallbackCopy(txt);
    }
  }

  function fallbackCopy(txt){
    var ta = document.createElement('textarea');
    ta.value = txt;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (err) {}
    document.body.removeChild(ta);
  }

  function applyViewCode(){
    var nums = (panoCode.value.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    if (nums.length < 3) return;
    targetLon = nums[0];
    targetLat = clamp(nums[1], -85, 85);
    targetFov = clamp(nums[2] || 75, 20, 100);
  }

  function downloadOriginal(){
    if (!currentFullSrc) return;
    var name = currentFileName || ('下载原图.' + extOf(currentFullSrc));
    fetch(currentFullSrc).then(function(res){
      if (!res.ok) throw new Error('http ' + res.status);
      return res.blob();
    }).then(function(blob){
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function(){ URL.revokeObjectURL(url); }, 1500);
    }).catch(function(){
      var a = document.createElement('a');
      a.href = currentFullSrc;
      a.download = name;
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  }

  function initViewer(){
    bindControls();

    if (!window.THREE || !viewer){
      if (panoEmpty){
        panoEmpty.querySelector('b').textContent = '浏览器缺少 Three.js 依赖，无法打开全景预览';
        panoEmpty.querySelector('span').textContent = '';
      }
      return;
    }

    try {
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1100);
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
      else if ('outputEncoding' in renderer) renderer.outputEncoding = THREE.sRGBEncoding;
      viewer.appendChild(renderer.domElement);
      var geo = new THREE.SphereGeometry(500, 96, 64);
      geo.scale(-1, 1, 1);
      sphere = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x101214 }));
      scene.add(sphere);
      resizeViewer();
    } catch (err){
      if (panoEmpty){
        panoEmpty.querySelector('b').textContent = '此浏览器不支持 WebGL，无法打开全景预览';
        panoEmpty.querySelector('span').textContent = '';
      }
      return;
    }

    window.addEventListener('resize', function(){ resizeViewer(); });
    document.addEventListener('fullscreenchange', function(){ setTimeout(resizeViewer, 80); });
    document.addEventListener('webkitfullscreenchange', function(){ setTimeout(resizeViewer, 80); });

    raf = requestAnimationFrame(animate);
  }

  // ---- Enlarged side-by-side compare viewer ----
  var zoomEl = $id('zoom');
  var zoomStage = $id('zoom-stage');
  var zoomImg = $id('zoom-img');
  var zoomCompare = $id('zoom-compare');
  var zoomBase = $id('zoom-base');
  var zoomOverlay = $id('zoom-overlay');
  var zoomDivider = $id('zoom-divider');
  var zoomHandle = $id('zoom-handle');
  var zoomCap = $id('zoom-cap');
  var zoomOpen = $id('zoom-open');

  var zoomMode = 'compare';
  var zoomScale = 1, zoomMin = 0.04, zoomMax = 8;
  var cmpPos = 50;

  function zoomDims(){
    if (zoomMode === 'compare') return { w: zoomBase.naturalWidth || 1, h: zoomBase.naturalHeight || 1 };
    return { w: zoomImg.naturalWidth || 1, h: zoomImg.naturalHeight || 1 };
  }

  function applyZoomLayout(){
    var d = zoomDims(), iw = d.w * zoomScale, ih = d.h * zoomScale;
    var sw = zoomStage.clientWidth, sh = zoomStage.clientHeight;
    var el = zoomMode === 'compare' ? zoomCompare : zoomImg;
    el.style.width = iw + 'px';
    el.style.height = ih + 'px';
    el.style.marginLeft = (iw < sw ? Math.max(0, (sw - iw) / 2) + 'px' : '0px');
    el.style.marginTop = (ih < sh ? Math.max(0, (sh - ih) / 2) + 'px' : '0px');
    if (iw < sw && ih < sh){ zoomStage.scrollLeft = 0; zoomStage.scrollTop = 0; }
  }

  function fitZoomStage(){
    var d = zoomDims(), sw = zoomStage.clientWidth || 1, sh = zoomStage.clientHeight || 1;
    zoomScale = Math.max(zoomMin, Math.min(zoomMax, Math.min(sw / d.w, sh / d.h)));
    applyZoomLayout();
  }

  function updateZoomDivider(){
    zoomOverlay.style.clipPath = 'inset(0 ' + (100 - cmpPos) + '% 0 0)';
    zoomDivider.style.left = cmpPos + '%';
    zoomHandle.style.left = cmpPos + '%';
  }

  function openCompare(leftSrc, leftCaption, rightSrc, rightCaption, initialPos){
    if (!zoomEl) return;
    zoomMode = 'compare';
    cmpPos = typeof initialPos === 'number' ? clamp(initialPos, 0, 100) : 50;
    zoomImg.classList.add('hide');
    zoomCompare.classList.add('show');
    zoomBase.onload = fitZoomStage;
    zoomBase.src = rightSrc;
    zoomOverlay.src = leftSrc;
    zoomCap.textContent = '左：' + (leftCaption || '') + '  ·  右：' + (rightCaption || '');
    zoomOpen.setAttribute('href', rightSrc);
    updateZoomDivider();
    zoomEl.classList.add('open');
    if (zoomBase.complete && zoomBase.naturalWidth) fitZoomStage();
  }

  function closeZoom(){
    if (!zoomEl) return;
    zoomEl.classList.remove('open');
    zoomImg.src = '';
    zoomBase.src = '';
    zoomOverlay.src = '';
    zoomImg.classList.remove('hide');
    zoomCompare.classList.remove('show');
  }

  function zoomBy(factor){
    var old = zoomScale;
    zoomScale = clamp(zoomScale * factor, zoomMin, zoomMax);
    var sw = zoomStage.clientWidth, sh = zoomStage.clientHeight;
    var cx = sw / 2, cy = sh / 2;
    var k = zoomScale / old;
    zoomStage.scrollLeft = (zoomStage.scrollLeft + cx) * k - cx;
    zoomStage.scrollTop = (zoomStage.scrollTop + cy) * k - cy;
    applyZoomLayout();
  }

  if (zoomStage){
    zoomStage.addEventListener('wheel', function(e){
      if (!zoomEl.classList.contains('open')) return;
      e.preventDefault();
      var rect = zoomStage.getBoundingClientRect();
      var mx = e.clientX - rect.left, my = e.clientY - rect.top;
      var old = zoomScale;
      zoomScale = clamp(zoomScale * (e.deltaY < 0 ? 1.18 : 1 / 1.18), zoomMin, zoomMax);
      var k = zoomScale / old;
      zoomStage.scrollLeft = (zoomStage.scrollLeft + mx) * k - mx;
      zoomStage.scrollTop = (zoomStage.scrollTop + my) * k - my;
      applyZoomLayout();
    }, { passive: false });

    var zoomPan = null;
    zoomStage.addEventListener('pointerdown', function(e){
      if (e.target === zoomHandle) return;
      if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
      zoomPan = { x: e.clientX, y: e.clientY, left: zoomStage.scrollLeft, top: zoomStage.scrollTop };
      try { if (zoomStage.setPointerCapture) zoomStage.setPointerCapture(e.pointerId); } catch (err) {}
      zoomStage.classList.add('dragging');
    });
    zoomStage.addEventListener('pointermove', function(e){
      if (!zoomPan) return;
      zoomStage.scrollLeft = zoomPan.left - (e.clientX - zoomPan.x);
      zoomStage.scrollTop = zoomPan.top - (e.clientY - zoomPan.y);
    });
    function endZoomPan(e){ zoomPan = null; zoomStage.classList.remove('dragging'); }
    zoomStage.addEventListener('pointerup', endZoomPan);
    zoomStage.addEventListener('pointercancel', endZoomPan);
  }

  if (zoomHandle){
    var hDrag = null;
    zoomHandle.addEventListener('pointerdown', function(e){
      e.stopPropagation();
      hDrag = e.pointerId;
      try { if (zoomHandle.setPointerCapture) zoomHandle.setPointerCapture(e.pointerId); } catch (err) {}
    });
    zoomHandle.addEventListener('pointermove', function(e){
      if (hDrag !== e.pointerId) return;
      var r = zoomCompare.getBoundingClientRect();
      if (r.width > 0) cmpPos = clamp((e.clientX - r.left) / r.width * 100, 0, 100);
      updateZoomDivider();
    });
    zoomHandle.addEventListener('pointerup', function(e){ if (hDrag === e.pointerId) hDrag = null; });
    zoomHandle.addEventListener('pointercancel', function(e){ if (hDrag === e.pointerId) hDrag = null; });
  }

  if ($id('zoom-in')) $id('zoom-in').addEventListener('click', function(){ zoomBy(1.35); });
  if ($id('zoom-out')) $id('zoom-out').addEventListener('click', function(){ zoomBy(1 / 1.35); });
  if ($id('zoom-100')) $id('zoom-100').addEventListener('click', function(){ zoomScale = Math.min(1, zoomMax); applyZoomLayout(); });
  if ($id('zoom-fit')) $id('zoom-fit').addEventListener('click', fitZoomStage);
  if ($id('zoom-close')) $id('zoom-close').addEventListener('click', closeZoom);

  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape'){
      if (zoomEl && zoomEl.classList.contains('open')) closeZoom();
    }
  });
  // ---- Page utilities ----
  var topBtn = $id('toTop');
  if (topBtn){
    window.addEventListener('scroll', function(){ topBtn.classList.toggle('show', window.scrollY > 800); });
    topBtn.addEventListener('click', function(){ window.scrollTo({ top: 0, behavior: 'smooth' }); });
  }

  initViewer();
})();
