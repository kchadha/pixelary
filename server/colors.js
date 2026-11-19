// Color interpreter: turns a single word into a hex color.
// Known words (CSS named colors + playful extras) are deterministic.
// Unknown words get a random bright color every time — chaos is a feature.

const CSS_COLORS = {
  aliceblue: '#f0f8ff', antiquewhite: '#faebd7', aqua: '#00ffff', aquamarine: '#7fffd4',
  azure: '#f0ffff', beige: '#f5f5dc', bisque: '#ffe4c4', black: '#000000',
  blanchedalmond: '#ffebcd', blue: '#0000ff', blueviolet: '#8a2be2', brown: '#a52a2a',
  burlywood: '#deb887', cadetblue: '#5f9ea0', chartreuse: '#7fff00', chocolate: '#d2691e',
  coral: '#ff7f50', cornflowerblue: '#6495ed', cornsilk: '#fff8dc', crimson: '#dc143c',
  cyan: '#00ffff', darkblue: '#00008b', darkcyan: '#008b8b', darkgoldenrod: '#b8860b',
  darkgray: '#a9a9a9', darkgreen: '#006400', darkgrey: '#a9a9a9', darkkhaki: '#bdb76b',
  darkmagenta: '#8b008b', darkolivegreen: '#556b2f', darkorange: '#ff8c00', darkorchid: '#9932cc',
  darkred: '#8b0000', darksalmon: '#e9967a', darkseagreen: '#8fbc8f', darkslateblue: '#483d8b',
  darkslategray: '#2f4f4f', darkslategrey: '#2f4f4f', darkturquoise: '#00ced1', darkviolet: '#9400d3',
  deeppink: '#ff1493', deepskyblue: '#00bfff', dimgray: '#696969', dimgrey: '#696969',
  dodgerblue: '#1e90ff', firebrick: '#b22222', floralwhite: '#fffaf0', forestgreen: '#228b22',
  fuchsia: '#ff00ff', gainsboro: '#dcdcdc', ghostwhite: '#f8f8ff', gold: '#ffd700',
  goldenrod: '#daa520', gray: '#808080', green: '#008000', greenyellow: '#adff2f',
  grey: '#808080', honeydew: '#f0fff0', hotpink: '#ff69b4', indianred: '#cd5c5c',
  indigo: '#4b0082', ivory: '#fffff0', khaki: '#f0e68c', lavender: '#e6e6fa',
  lavenderblush: '#fff0f5', lawngreen: '#7cfc00', lemonchiffon: '#fffacd', lightblue: '#add8e6',
  lightcoral: '#f08080', lightcyan: '#e0ffff', lightgoldenrodyellow: '#fafad2', lightgray: '#d3d3d3',
  lightgreen: '#90ee90', lightgrey: '#d3d3d3', lightpink: '#ffb6c1', lightsalmon: '#ffa07a',
  lightseagreen: '#20b2aa', lightskyblue: '#87cefa', lightslategray: '#778899', lightslategrey: '#778899',
  lightsteelblue: '#b0c4de', lightyellow: '#ffffe0', lime: '#00ff00', limegreen: '#32cd32',
  linen: '#faf0e6', magenta: '#ff00ff', maroon: '#800000', mediumaquamarine: '#66cdaa',
  mediumblue: '#0000cd', mediumorchid: '#ba55d3', mediumpurple: '#9370db', mediumseagreen: '#3cb371',
  mediumslateblue: '#7b68ee', mediumspringgreen: '#00fa9a', mediumturquoise: '#48d1cc', mediumvioletred: '#c71585',
  midnightblue: '#191970', mintcream: '#f5fffa', mistyrose: '#ffe4e1', moccasin: '#ffe4b5',
  navajowhite: '#ffdead', navy: '#000080', oldlace: '#fdf5e6', olive: '#808000',
  olivedrab: '#6b8e23', orange: '#ffa500', orangered: '#ff4500', orchid: '#da70d6',
  palegoldenrod: '#eee8aa', palegreen: '#98fb98', paleturquoise: '#afeeee', palevioletred: '#db7093',
  papayawhip: '#ffefd5', peachpuff: '#ffdab9', peru: '#cd853f', pink: '#ffc0cb',
  plum: '#dda0dd', powderblue: '#b0e0e6', purple: '#800080', rebeccapurple: '#663399',
  red: '#ff0000', rosybrown: '#bc8f8f', royalblue: '#4169e1', saddlebrown: '#8b4513',
  salmon: '#fa8072', sandybrown: '#f4a460', seagreen: '#2e8b57', seashell: '#fff5ee',
  sienna: '#a0522d', silver: '#c0c0c0', skyblue: '#87ceeb', slateblue: '#6a5acd',
  slategray: '#708090', slategrey: '#708090', snow: '#fffafa', springgreen: '#00ff7f',
  steelblue: '#4682b4', tan: '#d2b48c', teal: '#008080', thistle: '#d8bfd8',
  tomato: '#ff6347', turquoise: '#40e0d0', violet: '#ee82ee', wheat: '#f5deb3',
  white: '#ffffff', whitesmoke: '#f5f5f5', yellow: '#ffff00', yellowgreen: '#9acd32',
};

// Playful everyday words that "obviously" have a color.
const FUN_COLORS = {
  banana: '#ffe135', lemon: '#fff44f', sun: '#ffcc33', sunny: '#ffcc33', butter: '#fff1a8',
  mustard: '#e1ad01', honey: '#eba937', corn: '#fbec5d', cheese: '#ffc93c',
  sky: '#87ceeb', ocean: '#1f6fb2', sea: '#2e8bc0', water: '#4fb3e8', ice: '#d6f3ff',
  denim: '#1560bd', blueberry: '#4f86f7', jeans: '#3b5b92', sapphire: '#0f52ba',
  grass: '#4caf50', leaf: '#5aa832', mint: '#98ff98', slime: '#9bff3a', frog: '#5fa83a',
  pickle: '#8db600', avocado: '#568203', emerald: '#50c878', moss: '#8a9a5b', jade: '#00a86b',
  cherry: '#d2042d', strawberry: '#fc5a8d', blood: '#8a0303', ruby: '#e0115f',
  apple: '#e23d28', fire: '#ff4500', lava: '#cf1020', rose: '#ff007f', ketchup: '#c21807',
  pumpkin: '#ff7518', carrot: '#ed9121', tangerine: '#f28500', peach: '#ffcba4',
  apricot: '#fbceb1', mango: '#ffc324', flame: '#e25822',
  grape: '#6f2da8', eggplant: '#614051', lilac: '#c8a2c8', amethyst: '#9966cc',
  bubblegum: '#ffc1cc', flamingo: '#fc8eac', candy: '#ff6fb5', blush: '#de5d83', cotton: '#ffbcd9',
  night: '#0b1026', midnight: '#191970', coal: '#1b1b1b', ink: '#1a1a2e', shadow: '#2b2b2b',
  space: '#0d0221', void: '#000000',
  cloud: '#f2f6fa', milk: '#fdfff5', paper: '#f8f5ee', ghost: '#f8f8ff', pearl: '#eae0c8',
  sand: '#c2b280', beach: '#f5deb3', desert: '#edc9af', stone: '#888c8d', rock: '#7d7d7d',
  concrete: '#95a5a6', ash: '#b2beb5', smoke: '#848884', steel: '#71797e',
  rust: '#b7410e', copper: '#b87333', bronze: '#cd7f32', brass: '#b5a642',
  dirt: '#7b5c3a', mud: '#70543e', wood: '#a0702e', coffee: '#6f4e37', cocoa: '#5a3a22',
  caramel: '#c68e17', toast: '#c8915d', bread: '#e3c08d', cinnamon: '#d2691e',
  skin: '#f1c27d', vanilla: '#f3e5ab', cream: '#fffdd0',
  neon: '#39ff14', electric: '#7df9ff', toxic: '#a4ff00',
};

// Words that are actually multi-word color names said as one ("sky blue" handled by parser joining).
const ALL_COLORS = { ...CSS_COLORS, ...FUN_COLORS };

function normalize(word) {
  return String(word || '').toLowerCase().replace(/[^a-z]/g, '');
}

function lookup(word) {
  const w = normalize(word);
  if (!w) return null;
  if (ALL_COLORS[w]) return ALL_COLORS[w];
  // simple plural / adjective endings: "bananas", "cherries", "grassy", "reddish"
  const variants = [
    w.replace(/ies$/, 'y'),
    w.replace(/es$/, ''),
    w.replace(/s$/, ''),
    w.replace(/y$/, ''),
    w.replace(/ish$/, ''),
    w.replace(/dish$/, ''), // reddish -> red
  ];
  for (const v of variants) if (v && ALL_COLORS[v]) return ALL_COLORS[v];
  return null;
}

function isKnownColor(word) {
  return lookup(word) !== null;
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

function randomColor(rand = Math.random) {
  const h = Math.floor(rand() * 360);
  const s = 60 + Math.floor(rand() * 31);
  const l = 45 + Math.floor(rand() * 21);
  return hslToHex(h, s, l);
}

/** word -> { hex, known } */
function interpretColor(word, rand = Math.random) {
  const hex = lookup(word);
  if (hex) return { hex, known: true };
  return { hex: randomColor(rand), known: false };
}

module.exports = { interpretColor, isKnownColor, normalize, ALL_COLORS };
