import sanitizeHtml from 'sanitize-html';

/**
 * What a logo or an icon is drawn with, and nothing else.
 *
 * An allowlist, so what it does not name is gone -- script, foreignObject, a, image, the
 * animation elements, editors' own namespaces. Names keep their case: viewBox, clipPath and
 * linearGradient are not their lowercase selves.
 */
const ELEMENTS = [
  'svg', 'g', 'defs', 'symbol', 'use', 'title', 'desc', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline',
  'polygon', 'text', 'tspan', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'style',
];

const ATTRIBUTES = [
  'xmlns', 'xmlns:xlink', 'version', 'viewBox', 'preserveAspectRatio', 'width', 'height',
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'dx', 'dy', 'd', 'points', 'pathLength',
  'transform', 'id', 'class', 'style', 'href', 'xlink:href',
  'fill', 'fill-opacity', 'fill-rule', 'clip-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'opacity', 'color', 'display', 'visibility',
  'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform', 'spreadMethod',
  'clip-path', 'clipPathUnits', 'mask', 'maskUnits', 'maskContentUnits',
  'font-family', 'font-size', 'font-style', 'font-weight', 'letter-spacing', 'text-anchor', 'dominant-baseline',
];

/** A reference inside this file -- the only kind a logo needs. */
const internal = (value: string) => value.trim().startsWith('#');

/**
 * CSS that loads nothing from outside the file.
 *
 * `@import` goes, and so does every `url()` that is not a `#` reference. CSS with an escape in
 * it is dropped whole, as is `image-set()`: an escape can spell `url(` without its letters,
 * and a logo has no use for either.
 */
export function insideOnlyCss(css: string): string {
  if (/\\|image-set\s*\(/i.test(css)) return '';
  // The lookahead reads past spaces and a quote to the first real character, so `url( #g )`
  // is a reference inside the file and `url("https://…")` is not.
  return css.replace(/@import[^;]*;?/gi, '').replace(/url\((?!\s*['"]?\s*#)[^)]*\)/gi, 'none');
}

/**
 * The file as it may be stored and served.
 *
 * The site shows it only through `<img>`, where a browser runs nothing and loads nothing
 * outside. This is for the other way in: the file opened at its own address, where it is a
 * document and this is the only guard -- TomeCMS does not set the headers the media origin
 * sends.
 */
export function sanitizeSvg(source: string): string {
  const sanitized = sanitizeHtml(source, {
    allowedTags: ELEMENTS,
    allowedAttributes: { '*': ATTRIBUTES },
    // style is allowed on purpose; what it may say is checked below.
    allowVulnerableTags: true,
    // A dropped element takes its text with it, rather than leaving it loose in the drawing.
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'foreignObject', 'metadata'],
    parser: { xmlMode: true, lowerCaseTags: false, lowerCaseAttributeNames: false },
    transformTags: {
      '*': (tagName, attribs) => ({
        tagName,
        attribs: Object.fromEntries(Object.entries(attribs)
          .filter(([name, value]) => !/^(xlink:)?href$/.test(name) || internal(value))
          .map(([name, value]) => [name, name === 'style' ? insideOnlyCss(value) : value])),
      }),
    },
  });
  // sanitize-html passes a style element's text through untouched, so it is read here.
  return sanitized
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/g, (_, open: string, css: string, close: string) => `${open}${insideOnlyCss(css)}${close}`)
    .trim();
}
