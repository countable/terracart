"""Leaflet review viewer for DeepForest tree detections.

Unlike satextract.visualize (one color per source), this grades each crown by
confidence and gives you a live min-score slider, so you can eyeball the
recall/precision tradeoff of a low-threshold run:

    python3 tools/tree_review.py data/trees_z20_t10.geojson out.html \
        --title "z20 thresh 0.10"

Optionally overlay a second (baseline) layer for side-by-side comparison:

    python3 tools/tree_review.py new.geojson out.html --baseline old.geojson
"""
import argparse
import json


_HTML = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>tree review — __TITLE__</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>
  html, body, #map { height: 100%; margin: 0; }
  .panel { background: rgba(255,255,255,0.94); padding: 10px 13px;
           font: 13px/1.5 system-ui, sans-serif; border-radius: 8px;
           box-shadow: 0 1px 6px rgba(0,0,0,0.3); min-width: 210px; }
  .panel h3 { margin: 0 0 6px; font-size: 13px; }
  .panel .count { font-weight: 700; font-size: 22px; }
  .panel input[type=range] { width: 100%; }
  .swatch { display:inline-block; width:11px; height:11px; border-radius:50%;
            border:1px solid #222; vertical-align:-1px; margin-right:4px; }
  .muted { opacity: 0.7; }
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const FEATURES = __FEATURES__;
const BASELINE = __BASELINE__;
const BBOX = __BBOX__;

const map = L.map("map");
const esri = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  { maxZoom: 21, maxNativeZoom: 20, attribution: "Esri World Imagery" }
).addTo(map);

// confidence -> color (red=low, yellow=mid, green=high)
function scoreColor(s) {
  const h = Math.max(0, Math.min(120, (s) * 120 * 1.6)); // 0..~0.75 spans red->green
  return `hsl(${h}, 85%, 48%)`;
}

const baseLayer = L.layerGroup();
if (BASELINE) {
  for (const f of BASELINE.features) {
    const [lon, lat] = f.geometry.coordinates;
    L.circleMarker([lat, lon], {
      radius: 4, color: "#fff", weight: 1, opacity: 0.5,
      fillColor: "#1e3a8a", fillOpacity: 0.0, dashArray: "2",
    }).addTo(baseLayer);
  }
}

// Dot SIZE encodes crown size in 3 tiers (not to scale); dot COLOR encodes
// confidence. Tier cut-points are on crown_m (diameter, metres).
function crownTier(c) {
  if (c < 2.0) return { px: 4, name: "small (<2 m)" };
  if (c < 3.5) return { px: 6.5, name: "medium (2–3.5 m)" };
  return { px: 9, name: "large (≥3.5 m)" };
}
let markers = [];
for (const f of FEATURES.features) {
  const [lon, lat] = f.geometry.coordinates;
  const p = f.properties || {};
  const s = p.score ?? 1;
  const crown = p.crown_m ?? 2.5;
  const t = crownTier(crown);
  const m = L.circleMarker([lat, lon], {
    radius: t.px, color: "#000", weight: 1,
    fillColor: scoreColor(s), fillOpacity: 0.85,
  });
  m.bindPopup(`<b>tree</b> <span class="muted">${(s*100).toFixed(0)}%</span><br>`
              + `<small class="muted">${crown} m crown · ${t.name}</small>`);
  m._score = s;
  markers.push(m);
}
const treeLayer = L.layerGroup(markers).addTo(map);

if (BBOX) { const [w,s,e,n] = BBOX; map.fitBounds([[s,w],[n,e]]); }
else if (markers.length) map.fitBounds(L.featureGroup(markers).getBounds(), {padding:[24,24]});

L.control.layers(
  { "Esri Imagery": esri },
  { "Trees (graded)": treeLayer, ...(BASELINE ? {"Baseline (hollow)": baseLayer} : {}) }
).addTo(map);

// control panel with live min-score slider
const ctrl = L.control({ position: "topright" });
ctrl.onAdd = () => {
  const d = L.DomUtil.create("div", "panel");
  d.innerHTML =
    `<h3>__TITLE__</h3>` +
    `<div class="count" id="cnt"></div><div class="muted" id="sub"></div>` +
    `<div style="margin-top:8px">min score: <b id="thr">0.00</b></div>` +
    `<input type="range" id="sl" min="0" max="100" value="0">` +
    `<div style="margin-top:6px" class="muted">color = confidence<br>` +
    `<span class="swatch" style="background:${scoreColor(0.1)}"></span>low ` +
    `<span class="swatch" style="background:${scoreColor(0.4)}"></span>mid ` +
    `<span class="swatch" style="background:${scoreColor(0.7)}"></span>high</div>` +
    `<div style="margin-top:4px" class="muted">size = crown<br>` +
    `<span class="swatch" style="width:8px;height:8px;background:#777"></span>small ` +
    `<span class="swatch" style="width:13px;height:13px;background:#777"></span>med ` +
    `<span class="swatch" style="width:18px;height:18px;background:#777"></span>large</div>`;
  L.DomEvent.disableClickPropagation(d);
  return d;
};
ctrl.addTo(map);

// live zoom readout (bottom-left)
const zlabel = L.control({ position: "bottomleft" });
zlabel.onAdd = () => {
  const d = L.DomUtil.create("div", "panel");
  d.style.padding = "5px 9px";
  const upd = () => { d.innerHTML = `zoom <b>${map.getZoom()}</b>`; };
  map.on("zoomend", upd); upd();
  return d;
};
zlabel.addTo(map);

const total = markers.length;
function applyThreshold(t) {
  let shown = 0;
  for (const m of markers) {
    if (m._score >= t) { if (!map.hasLayer(m)) treeLayer.addLayer(m); shown++; }
    else if (treeLayer.hasLayer(m)) treeLayer.removeLayer(m);
  }
  document.getElementById("cnt").textContent = shown + " trees";
  document.getElementById("sub").textContent =
    (total - shown) + " hidden of " + total + (BASELINE ? "  ·  baseline "+BASELINE.features.length : "");
  document.getElementById("thr").textContent = t.toFixed(2);
}
const sl = document.getElementById("sl");
sl.addEventListener("input", e => applyThreshold(e.target.value / 100));
applyThreshold(0);
</script>
</body>
</html>
"""


def render(geojson_path, out_path, title="tree review", baseline_path=None):
    with open(geojson_path, encoding="utf-8") as f:
        fc = json.load(f)
    baseline = "null"
    if baseline_path:
        with open(baseline_path, encoding="utf-8") as f:
            baseline = json.dumps(json.load(f), separators=(",", ":"))
    html = (_HTML
            .replace("__FEATURES__", json.dumps(fc, separators=(",", ":")))
            .replace("__BASELINE__", baseline)
            .replace("__BBOX__", json.dumps(fc.get("bbox")))
            .replace("__TITLE__", title))
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("geojson")
    p.add_argument("out")
    p.add_argument("--title", default="tree review")
    p.add_argument("--baseline", default=None)
    a = p.parse_args()
    render(a.geojson, a.out, a.title, a.baseline)
    print("wrote", a.out)
