#!/usr/bin/env node
// Generate the story-splash banners (assets/art/*.png) with gpt-image-1.5.
//
// Reads OPENAI_API_KEY from ~/.env (or the environment), renders each piece at
// 1536x1024, then downscales to 512px wide (the size the dialogs lazy-load)
// with PIL. Usage:
//
//   node tools/gen_story_art.js              # all pieces missing from assets/art/
//   node tools/gen_story_art.js --force      # regenerate everything
//   node tools/gen_story_art.js story_wake   # one piece
//
// The shared STYLE string is what keeps the set palette-matched to the four
// original banners (trail_intro etc.) — warm golden-hour, dithered 16-bit.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const OUT_DIR = path.join(__dirname, '..', 'assets', 'art');
const RAW_DIR = path.join(OUT_DIR, 'raw');

const STYLE =
  'Detailed 16-bit pixel art storybook illustration for a cozy village-rebuilding RPG. ' +
  'Warm golden-hour palette: amber and dusty-orange sky with visible dithering, olive-green ' +
  'foliage, brown earth, cream highlights. Retro SNES-era pixel clusters, crisp clusters, no ' +
  'anti-aliased smooth gradients. Wide landscape composition, gentle melancholy turning to hope. ' +
  'No text, no letters, no UI, no watermark.';

// A piece is either a subject string (landscape 1536x1024 -> 512px banner)
// or { subject, size, width } for a different frame - the safety screen's
// fullscreen mobile backdrop is portrait.
const PIECES = {
  trap_jaw:
    'A rusty steel bear trap bursting out of cracked earth, its metal jaws clamped shut ' +
    'around a farmer\'s boot, dirt and small stones flying, the farmer stumbling. Shock ' +
    'moment in warm dusk light, close and low to the ground.',
  trap_free:
    'A farmer kneels on cracked dry earth prying open a rusty steel bear trap\'s jaws with ' +
    'both hands, boot just pulled free, effort turning to relief, warm dusk light, close ' +
    'and low to the ground.',
  tool_till:
    'A farmer drives a hoe into meadow soil, the first dark furrow turning over in neat ' +
    'squares, dew on the grass, dawn light. A satisfying first strike.',
  tool_chop:
    'A farmer swings an axe into a tree trunk, wood chips flying, a fresh notch in the ' +
    'bark, warm afternoon light.',
  tool_dig:
    'A farmer swings a pickaxe into a grey boulder, sparks and stone chips flying, a crack ' +
    'forming in the rock, warm light.',
  tool_water:
    'A farmer tips a watering can over a small green sprout in a tilled bed, silver water ' +
    'arcing down, the soil darkening with damp, morning light.',
  tool_catch:
    'A farmer gently lowers a bug net over a startled chicken in long grass, the net hoop ' +
    'about to settle, playful tension, warm light.',
  tool_sword:
    'A farmer raises a simple iron sword against a lunging green slime in a meadow, the ' +
    'first determined swing, dynamic but cozy, warm light.',
  tool_shoot:
    'A farmer draws a short bow and looses an arrow across a meadow, the string still ' +
    'humming, the arrow in flight, warm light.',
  // The ONE money icon: a single gold coin on transparency. Not a banner -
  // generated large, trimmed to its opaque bounds, downscaled to a 64px
  // master (assets/art is for banners; the runtime copies live under
  // assets/Icons/ - see tools/gen_story_art.js --coin).
  coin_icon: {
    size: '1024x1024', width: 64, colors: 64, background: 'transparent', trim: true,
    style:
      '16-bit pixel art game icon, crisp chunky pixel clusters, warm gold palette. ' +
      'Transparent background, no shadow, no text.',
    subject:
      'A single round gold coin, flat straight-on front view, centred, filling the frame: ' +
      'darker amber outer rim, warm gold body, a cream pixel highlight at the top-left, an ' +
      'embossed five-pointed star in the centre. Nothing else in frame.',
  },
  safety_welcome: {
    size: '1024x1536', width: 640, colors: 96,
    subject:
      'Tall portrait scene: a young farmer with a hammer and a satchel of seeds rebuilds a ' +
      'ruined suburban home - fresh timber framing going up over scorched brick, one wall ' +
      'already repainted, a sunflower sprouting through rubble. Around them an overgrown ' +
      'post-collapse neighbourhood of caved roofs and boarded windows stretches to a dusky ' +
      'horizon. Hopeful reconstruction amid ruin: warm light on the house being restored, ' +
      'cooler amber gloom over the wrecks.',
  },
  story_wake:
    'Morning inside-and-out of a small weathered camping trailer parked in a misty meadow. ' +
    'A young survivor stretches awake at the trailer door, first amber sunlight over the grass. Quiet, hopeful.',
  story_wrecks:
    'A suburban neighbourhood of collapsed houses: boarded windows, caved roofs, rubble piles, ' +
    'weeds through cracked pavement. The same survivor stands small in the middle of the street ' +
    'taking it in. Golden light, overgrown but not grim.',
  restore_house:
    'A cozy restored cottage with fresh timber repairs, warm light in the windows, a small ' +
    'vegetable patch beside it. Two relieved neighbours admire it. Celebration of a home rebuilt.',
  restore_blacksmith:
    'A rebuilt stone smithy, forge glowing orange inside, an anvil by the door, horseshoes and ' +
    'tools hung outside. A burly blacksmith raises a hammer in greeting. Sparks in the dusk air.',
  restore_market:
    'A cheerful open-air market stand rebuilt: crates of pumpkins, apples and greens, sacks of ' +
    'seeds, a hand-painted awning. A shopkeeper arranges produce while a customer approaches with coins.',
  restore_trader:
    'A rebuilt trading post draped with rugs and hanging lanterns, shelves of jars and bolts of ' +
    'cloth. A travelling merchant with a pack mule barters with a villager, goods changing hands.',
  restore_wizard:
    'A tall crooked wizard tower restored, its crooked roof re-shingled, windows glowing violet, ' +
    'strange plants and brass instruments on the balcony. A reclusive mage in a starry robe peers ' +
    'down from the door at a visitor below.',
  delivery_first:
    'On the doorstep of a cottage at dusk, a farmer hands over a woven basket brimming with ' +
    'vegetables to a delighted elderly neighbour; a few gold coins glint in the exchange. Warm doorway light.',
  shiny_first:
    'A rare sparkling creature — a small chicken with shimmering golden iridescent feathers — ' +
    'bathed in a beam of light among ordinary dull ones, four-pointed golden glints floating above ' +
    'it in a meadow at dusk. Wonder and discovery.',
  castle_claim:
    'A grand stone castle gatehouse, its drawbridge down, a cream pennant banner being raised on ' +
    'a short pole above the gate. A grey-moustached castellan in a tabard bows to a young survivor. ' +
    'Torches lit, the vault door ajar with gold beyond.',
  fort_unseal:
    'A squat stone frontier fort, its heavy timber gates swinging open for the first time in years, ' +
    'dust falling, a quartermaster in boiled leather stepping out with a relic-laden rack behind him.',
};

function loadKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const envFile = path.join(process.env.HOME, '.env');
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?OPENAI_API_KEY\s*=\s*(.+?)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, '');
  }
  throw new Error('OPENAI_API_KEY not found in env or ~/.env');
}

async function generate(key, name, piece) {
  // The images endpoint 500s transiently under load - retry twice with a
  // short backoff before giving up the whole run over one hiccup.
  let res = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-image-1.5',
        prompt: `${piece.style || STYLE}\n\nScene: ${piece.subject}`,
        size: piece.size,
        ...(piece.background ? { background: piece.background } : {}),
        quality: 'high',
        n: 1,
      }),
    });
    if (res.ok || res.status < 500) break;
    if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 8000));
  }
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} ${await res.text()}`);
  const json = await res.json();
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error(`${name}: no b64_json in response`);
  const rawPath = path.join(RAW_DIR, `${name}.png`);
  fs.writeFileSync(rawPath, Buffer.from(b64, 'base64'));
  return rawPath;
}

function downscale(rawPath, name, width, colors, trim) {
  const outPath = path.join(OUT_DIR, `${name}.png`);
  // The piece's own width (512 for banners, 640 for the fullscreen backdrop),
  // then quantize: pixel art survives palette reduction intact (the clusters
  // ARE the palette), and it lands a banner near the ~60-80KB of the original
  // four instead of ~370KB.
  const py = `
from PIL import Image
im = Image.open(${JSON.stringify(rawPath)})
trim = ${trim ? 'True' : 'False'}
if trim:
    im = im.convert('RGBA')
    bbox = im.getchannel('A').getbbox()
    if bbox: im = im.crop(bbox)
    # Square the canvas: a trimmed coin is round, but an icon slot is square -
    # pad the shorter side with transparency so resize never squashes it.
    w0, h0 = im.size
    if w0 != h0:
        side = max(w0, h0)
        canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
        canvas.paste(im, ((side - w0) // 2, (side - h0) // 2))
        im = canvas
else:
    im = im.convert('RGB')
w, h = im.size
tw = ${width}
im = im.resize((tw, round(h * tw / w)), Image.LANCZOS)
if im.mode == 'RGBA':
    im = im.quantize(colors=${colors || 128}, method=Image.FASTOCTREE, dither=Image.FLOYDSTEINBERG)
else:
    im = im.quantize(colors=${colors || 128}, method=Image.MEDIANCUT, dither=Image.FLOYDSTEINBERG)
im.save(${JSON.stringify(outPath)}, optimize=True)
`;
  execFileSync('python3', ['-c', py]);
  return outPath;
}

(async () => {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  // --reprocess: skip the API entirely, re-downscale from assets/art/raw/.
  const reprocess = args.includes('--reprocess');
  const only = args.filter(a => !a.startsWith('--'));
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const key = reprocess ? null : loadKey();
  const names = only.length ? only : Object.keys(PIECES);
  for (const name of names) {
    if (!PIECES[name]) { console.error(`unknown piece: ${name}`); process.exitCode = 1; continue; }
    const piece = typeof PIECES[name] === 'string'
      ? { subject: PIECES[name], size: '1536x1024', width: 512 }
      : PIECES[name];
    const outPath = path.join(OUT_DIR, `${name}.png`);
    if (!force && !reprocess && fs.existsSync(outPath)) { console.log(`skip ${name} (exists)`); continue; }
    const rawPath = path.join(RAW_DIR, `${name}.png`);
    const raw = reprocess ? rawPath : await generate(key, name, piece);
    const out = downscale(raw, name, piece.width, piece.colors, piece.trim);
    // The coin's runtime slot is the Icons tree (the art/ copy is just the
    // generator's outbox); land it there too so a regen can't drift.
    if (name === 'coin_icon') {
      fs.copyFileSync(out, path.join(__dirname, '..', 'assets', 'Icons', 'coin.png'));
    }
    const kb = Math.round(fs.statSync(out).size / 1024);
    console.log(`ok (${kb}KB)`);
    // Gentle pacing: the images endpoint rate-limits bursty accounts.
    await new Promise(r => setTimeout(r, 2000));
  }
})().catch(e => { console.error(e.message || e); process.exit(1); });
