// src/ui/summarySnapshot.js
//
// Captures a live DOM subtree into a canvas, pixel-styled the way the
// browser actually rendered it — used by Plot Summary's top-bar share
// icon so the shared PNG matches the SCREEN view (cards, theme colors,
// on-screen charts), per explicit request, rather than the PDF layout.
//
// Why hand-rolled: the obvious shortcuts don't work here.
//  - SVG foreignObject rasterization TAINTS the canvas in several
//    engines (including iOS WebKit), which blocks PNG export entirely —
//    proven dead end, do not retry.
//  - html2canvas would work but is a ~200KB external dependency; this
//    app is offline-first and its summary screen markup is fully under
//    our control, so a small purpose-built painter is both lighter and
//    more predictable.
//
// How it works: walk the subtree in document order; for every element,
// read the browser's OWN layout numbers (getBoundingClientRect) and
// resolved styling (getComputedStyle) and replay them with plain canvas
// drawing — backgrounds, borders, radii, shadows, text (line-by-line at
// the real line positions, via Range client rects), <img>s, and inline
// <svg>s (serialized with their computed presentation styles inlined,
// then drawn as same-origin data-URL images — plain SVG, no
// foreignObject, so the canvas stays clean/exportable). Because every
// position comes from the real layout engine, the result matches the
// screen without this file implementing any CSS layout itself.

/**
 * Longhand properties inlined onto serialized SVG descendants — CSS
 * classes (styles.css) don't travel into a standalone SVG image, so
 * their computed results are written onto each node as style attributes.
 */
const SVG_STYLE_PROPS = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "text-anchor",
  "dominant-baseline",
];

/**
 * @param {CSSStyleDeclaration} cs
 * @returns {string} canvas font string for the element's computed style
 */
function canvasFont(cs) {
  const style = cs.fontStyle && cs.fontStyle !== "normal" ? `${cs.fontStyle} ` : "";
  const weight = cs.fontWeight && cs.fontWeight !== "400" ? `${cs.fontWeight} ` : "";
  return `${style}${weight}${cs.fontSize} ${cs.fontFamily}`;
}

/**
 * @param {string} color a computed color
 * @returns {boolean} true when it actually paints something
 */
function paintsColor(color) {
  return Boolean(color) && color !== "transparent" && !/rgba?\([^)]*[,/]\s*0\s*\)$/.test(color);
}

/**
 * Border radii for a box, honoring px and % values (50% = pill/circle).
 * @param {CSSStyleDeclaration} cs
 * @param {number} w
 * @param {number} h
 * @returns {[number, number, number, number]} TL, TR, BR, BL
 */
function borderRadii(cs, w, h) {
  const one = (raw) => {
    const v = String(raw || "0").split(" ")[0];
    if (v.endsWith("%")) return (parseFloat(v) / 100) * Math.min(w, h);
    return parseFloat(v) || 0;
  };
  const cap = Math.min(w, h) / 2;
  return [
    Math.min(one(cs.borderTopLeftRadius), cap),
    Math.min(one(cs.borderTopRightRadius), cap),
    Math.min(one(cs.borderBottomRightRadius), cap),
    Math.min(one(cs.borderBottomLeftRadius), cap),
  ];
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {[number, number, number, number]} radii
 */
function roundedRectPath(ctx, x, y, w, h, radii) {
  const [tl, tr, br, bl] = radii;
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.arcTo(x + w, y, x + w, y + tr, tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
  ctx.lineTo(x + bl, y + h);
  ctx.arcTo(x, y + h, x, y + h - bl, bl);
  ctx.lineTo(x, y + tl);
  ctx.arcTo(x, y, x + tl, y, tl);
  ctx.closePath();
}

/**
 * First outer shadow of a computed box-shadow, or null. (Computed form:
 * "rgba(...) 0px 1px 3px 0px" / "rgb(...) ...px inset" / "none".)
 * @param {string} boxShadow
 */
function parseFirstShadow(boxShadow) {
  if (!boxShadow || boxShadow === "none" || boxShadow.includes("inset")) return null;
  const m = boxShadow.match(/(rgba?\([^)]+\)|#[0-9a-fA-F]{3,8})\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px/);
  if (!m) return null;
  return { color: m[1], offsetX: parseFloat(m[2]), offsetY: parseFloat(m[3]), blur: parseFloat(m[4]) };
}

/**
 * Applies text-transform the way the browser displayed it, so the drawn
 * string matches the on-screen glyphs (e.g. uppercased stat labels).
 * @param {string} text
 * @param {string} transform computed text-transform
 */
function applyTextTransform(text, transform) {
  if (transform === "uppercase") return text.toUpperCase();
  if (transform === "lowercase") return text.toLowerCase();
  if (transform === "capitalize") return text.replace(/(^|\s)(\S)/g, (m, sp, ch) => sp + ch.toUpperCase());
  return text;
}

/**
 * Serializes an inline <svg> (computed styles inlined onto every
 * descendant) and draws it at its on-screen rect. Plain SVG-as-image is
 * same-origin-safe — it does NOT taint the canvas (unlike foreignObject).
 * @param {CanvasRenderingContext2D} ctx
 * @param {SVGSVGElement} svg
 * @param {{x: number, y: number, w: number, h: number}} box
 * @returns {Promise<void>}
 */
function drawSvgElement(ctx, svg, box) {
  const clone = svg.cloneNode(true);
  const liveNodes = [svg, ...svg.querySelectorAll("*")];
  const cloneNodes = [clone, ...clone.querySelectorAll("*")];
  liveNodes.forEach((liveNode, i) => {
    const cs = getComputedStyle(liveNode);
    const style = SVG_STYLE_PROPS.map((prop) => `${prop}:${cs.getPropertyValue(prop)}`).join(";");
    cloneNodes[i].setAttribute("style", style);
  });
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(box.w));
  clone.setAttribute("height", String(box.h));
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, box.x, box.y, box.w, box.h);
      resolve();
    };
    // A chart that somehow fails to rasterize shouldn't sink the whole
    // picture — skip it and keep going.
    img.onerror = () => resolve();
    img.src = url;
  });
}

/**
 * Draws one text node line-by-line at the browser's own line positions.
 * Handles wrapped lines, centered/right-aligned text (positions come
 * from the per-line rects, not from re-computing alignment), uppercase
 * transforms, letter-spacing, and single-line ellipsis truncation.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Text} node
 * @param {Element} parent
 * @param {{x: number, y: number}} origin capture-root offset
 */
function drawTextNode(ctx, node, parent, origin) {
  const raw = node.textContent;
  if (!raw || !raw.trim()) return;
  const cs = getComputedStyle(parent);

  ctx.font = canvasFont(cs);
  ctx.fillStyle = cs.color;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  if ("letterSpacing" in ctx) ctx.letterSpacing = cs.letterSpacing === "normal" ? "0px" : cs.letterSpacing;

  // Group characters into rendered lines by their individual client
  // rects — the only reliable way to recover both the wrap points AND
  // each line's exact x/y from the real layout.
  const range = document.createRange();
  const lines = [];
  let current = null;
  for (let i = 0; i < raw.length; i++) {
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    const rect = range.getClientRects()[0];
    if (!rect || (rect.width === 0 && /\s/.test(raw[i]))) continue; // collapsed whitespace
    if (!current || Math.abs(rect.top - current.top) > rect.height / 2) {
      current = { text: "", left: rect.left, top: rect.top, bottom: rect.bottom };
      lines.push(current);
    }
    current.text += raw[i];
    current.left = Math.min(current.left, rect.left);
    current.top = Math.min(current.top, rect.top);
    current.bottom = Math.max(current.bottom, rect.bottom);
  }
  range.detach();

  // Single-line ellipsis (e.g. a long cooperator name in the header
  // card): the DOM still holds the full string, but the screen shows a
  // truncated one — match the screen.
  const needsEllipsis = cs.textOverflow === "ellipsis" && cs.whiteSpace === "nowrap" && cs.overflow === "hidden";
  const maxWidth = needsEllipsis ? parent.getBoundingClientRect().width : Infinity;

  const metrics = ctx.measureText("Hg");
  const ascent = metrics.fontBoundingBoxAscent || parseFloat(cs.fontSize) * 0.8;
  const descent = metrics.fontBoundingBoxDescent || parseFloat(cs.fontSize) * 0.2;

  for (const line of lines) {
    let text = applyTextTransform(line.text, cs.textTransform);
    if (needsEllipsis && ctx.measureText(text).width > maxWidth) {
      while (text.length > 1 && ctx.measureText(`${text}…`).width > maxWidth) text = text.slice(0, -1);
      text += "…";
    }
    // Glyphs sit vertically centered in the line box (half-leading).
    const boxH = line.bottom - line.top;
    const baseline = line.top + (boxH - (ascent + descent)) / 2 + ascent;
    ctx.fillText(text, line.left - origin.x, baseline - origin.y);
  }
}

/**
 * Background, border, and shadow for one element's box.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Element} el
 * @param {CSSStyleDeclaration} cs
 * @param {{x: number, y: number, w: number, h: number}} box
 */
function drawBox(ctx, el, cs, box) {
  if (box.w <= 0 || box.h <= 0) return;
  const radii = borderRadii(cs, box.w, box.h);
  const bg = cs.backgroundColor;
  const shadow = parseFirstShadow(cs.boxShadow);

  if (paintsColor(bg)) {
    ctx.save();
    if (shadow) {
      ctx.shadowColor = shadow.color;
      ctx.shadowOffsetX = shadow.offsetX;
      ctx.shadowOffsetY = shadow.offsetY;
      ctx.shadowBlur = shadow.blur;
    }
    roundedRectPath(ctx, box.x, box.y, box.w, box.h, radii);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.restore();
  }

  const borderW = parseFloat(cs.borderTopWidth) || 0;
  if (borderW > 0 && cs.borderTopStyle !== "none" && paintsColor(cs.borderTopColor)) {
    ctx.save();
    roundedRectPath(ctx, box.x + borderW / 2, box.y + borderW / 2, box.w - borderW, box.h - borderW, radii);
    ctx.strokeStyle = cs.borderTopColor;
    ctx.lineWidth = borderW;
    ctx.stroke();
    ctx.restore();
  } else if (parseFloat(cs.borderBottomWidth) > 0 && cs.borderBottomStyle !== "none" && paintsColor(cs.borderBottomColor)) {
    // Bottom-only separators (e.g. brand-average rows).
    ctx.save();
    ctx.strokeStyle = cs.borderBottomColor;
    ctx.lineWidth = parseFloat(cs.borderBottomWidth);
    ctx.beginPath();
    ctx.moveTo(box.x, box.y + box.h);
    ctx.lineTo(box.x + box.w, box.y + box.h);
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * The nearest non-transparent background color at/above `el` — used to
 * paint the capture's page background (the capture root itself is
 * usually transparent, sitting on the themed <body>).
 * @param {Element} el
 * @returns {string}
 */
function resolvePageBackground(el) {
  let node = el;
  while (node && node instanceof Element) {
    const bg = getComputedStyle(node).backgroundColor;
    if (paintsColor(bg)) return bg;
    node = node.parentElement;
  }
  return "#ffffff";
}

/**
 * Renders `root` (as currently laid out on screen) into a canvas.
 *
 * @param {HTMLElement} root the subtree to capture
 * @param {{excludeSelector?: string, scale?: number, padding?: number}} [opts]
 *   excludeSelector: elements (and their subtrees) to leave out — used
 *     to drop interactive-only controls (buttons, the metric toggle)
 *     that would look odd in a shared picture.
 *   scale: device-pixel multiplier; capped so the canvas' total pixel
 *     count stays under mobile Safari's ~16.7M-pixel ceiling.
 *   padding: breathing room (CSS px) added around the capture.
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function captureElementToCanvas(root, opts = {}) {
  const excludeSelector = opts.excludeSelector || null;
  const padding = opts.padding === undefined ? 0 : opts.padding;
  const rootRect = root.getBoundingClientRect();
  const width = Math.ceil(rootRect.width) + padding * 2;
  const height = Math.ceil(rootRect.height) + padding * 2;
  const requested = opts.scale || Math.min(window.devicePixelRatio || 1, 2) || 1;
  const scale = Math.min(requested, Math.sqrt(16000000 / (width * height)) || requested);

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.fillStyle = resolvePageBackground(root);
  ctx.fillRect(0, 0, width, height);

  const origin = { x: rootRect.left - padding, y: rootRect.top - padding };

  /**
   * @param {Element} el
   * @param {number} inheritedAlpha
   */
  async function paint(el, inheritedAlpha) {
    if (excludeSelector && el.matches && el.matches(excludeSelector)) return;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return;
    const alpha = inheritedAlpha * (parseFloat(cs.opacity) || 1);
    if (alpha <= 0.01) return;
    const rect = el.getBoundingClientRect();
    const box = { x: rect.left - origin.x, y: rect.top - origin.y, w: rect.width, h: rect.height };

    ctx.globalAlpha = alpha;

    if (el instanceof SVGSVGElement) {
      await drawSvgElement(ctx, el, box);
      return; // svg internals are in the serialized image
    }
    if (el instanceof HTMLImageElement) {
      drawBox(ctx, el, cs, box);
      try {
        // object-fit: contain (the brand logo) — scale to fit, centered.
        const pad = parseFloat(cs.paddingLeft) || 0;
        const innerW = box.w - pad * 2;
        const innerH = box.h - pad * 2;
        const natW = el.naturalWidth || innerW;
        const natH = el.naturalHeight || innerH;
        const fit = cs.objectFit === "contain" ? Math.min(innerW / natW, innerH / natH) : null;
        const drawW = fit ? natW * fit : innerW;
        const drawH = fit ? natH * fit : innerH;
        ctx.drawImage(el, box.x + pad + (innerW - drawW) / 2, box.y + pad + (innerH - drawH) / 2, drawW, drawH);
      } catch (e) {
        // an undecodable image just doesn't draw — keep going
      }
      return;
    }

    drawBox(ctx, el, cs, box);
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        ctx.globalAlpha = alpha;
        drawTextNode(ctx, child, el, origin);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        await paint(child, alpha);
      }
    }
  }

  await paint(root, 1);
  ctx.globalAlpha = 1;
  return canvas;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<Blob>} PNG bytes
 */
export function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("couldn't encode the picture"))), "image/png");
  });
}
