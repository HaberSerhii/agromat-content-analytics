const bindings = new WeakMap();
let active, pointerType;

export function dismissTooltip() {
  active?.hide();
  active = undefined;
}

function observeDocument(document) {
  document.addEventListener('pointerdown', event => {
    pointerType = event.pointerType;
    if (active?.mode === 'tap' && !active.target.contains(event.target)) dismissTooltip();
  }, true);
  document.addEventListener('click', event => {
    if (active && !active.target.contains(event.target)) dismissTooltip();
  }, true);
  document.addEventListener('keydown', event => {
    pointerType = undefined;
    if (event.key === 'Escape') dismissTooltip();
  }, true);
  document.addEventListener('scroll', () => {
    if (active?.mode === 'tap') dismissTooltip();
  }, true);
}

const isTouch = type => type === 'touch' || type === 'pen';

export function bindTooltip(target, {show, hide, tap = true, hover = true, enter = true, toggle = true, consumeTap = false}) {
  if (bindings.has(target)) return bindings.get(target);
  if (!bindings.has(target.ownerDocument)) {
    observeDocument(target.ownerDocument);
    bindings.set(target.ownerDocument, true);
  }
  function reveal(event, mode = 'focus') {
    if (active?.target !== target) dismissTooltip();
    active = {target, hide, mode};
    show(event, mode);
  }
  const close = () => { if (active?.target === target) dismissTooltip(); };
  const hoverShow = event => {
    if (!isTouch(event.pointerType) && active?.mode !== 'tap') reveal(event, 'hover');
  };
  if (hover) {
    if (enter) target.addEventListener('pointerenter', hoverShow);
    target.addEventListener('pointermove', hoverShow);
    target.addEventListener('pointerleave', () => { if (active?.mode !== 'tap') close(); });
    target.addEventListener('focus', () => { if (!isTouch(pointerType)) reveal(); });
    target.addEventListener('blur', () => { if (active?.mode !== 'tap') close(); });
  }
  if (tap) target.addEventListener('click', event => {
    if (!isTouch(event.pointerType || pointerType) && !event.sourceCapabilities?.firesTouchEvents) return;
    if (consumeTap) event.stopPropagation();
    if (toggle && active?.target === target && active.mode === 'tap') close();
    else reveal(event, 'tap');
  });
  bindings.set(target, reveal);
  return reveal;
}

export function placeFixedTooltip(tooltip, x, y) {
  const viewport = tooltip.ownerDocument.defaultView;
  const width = tooltip.offsetWidth, height = tooltip.offsetHeight;
  tooltip.style.left = Math.max(8, Math.min(x, viewport.innerWidth - width - 8)) + 'px';
  tooltip.style.top = Math.max(8, Math.min(y, viewport.innerHeight - height - 8)) + 'px';
}

export function bindTitleTooltips(root, selector) {
  const document = root.ownerDocument || root;
  for (const target of root.querySelectorAll(selector)) {
    bindTooltip(target, {hover:false, consumeTap:true, show(event) {
      let tooltip = document.querySelector('#studio-touch-tooltip');
      if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'studio-touch-tooltip';
        tooltip.className = 'bo-quarter-tooltip studio-touch-tooltip';
        tooltip.setAttribute('role', 'tooltip');
        document.body.append(tooltip);
      }
      tooltip.textContent = target.title;
      tooltip.hidden = false;
      placeFixedTooltip(tooltip, event.clientX + 12, event.clientY + 14);
    }, hide() {
      const tooltip = document.querySelector('#studio-touch-tooltip');
      if (tooltip) tooltip.hidden = true;
    }});
  }
}
