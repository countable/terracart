"""Bake a FeatureCollection into a self-contained Leaflet HTML viewer.

Renders the GeoJSON over an Esri World Imagery basemap (toggleable with OSM),
colors points by source, and shows kind / score / OSM tags in a popup. The
output is a single .html file you can open with `file://` — no server needed.
"""
import json


_HTML = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>satextract</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>
  html, body, #map { height: 100%; margin: 0; }
  .legend { background: rgba(255,255,255,0.92); padding: 8px 12px;
            font: 12px/1.4 system-ui, sans-serif; border-radius: 6px;
            box-shadow: 0 1px 4px rgba(0,0,0,0.2); }
  .legend .row { display: flex; align-items: center; gap: 6px; margin: 2px 0; }
  .legend .dot { width: 10px; height: 10px; border-radius: 50%;
                 border: 1px solid #333; }
  .popup-tags { font-family: ui-monospace, monospace; font-size: 11px;
                white-space: pre-wrap; max-width: 260px; max-height: 180px;
                overflow: auto; background: #f6f6f6; padding: 4px;
                border-radius: 4px; margin-top: 4px; }
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const FEATURES = __FEATURES__;
const COLORS = {
  osm: "#3b82f6",
  deepforest: "#22c55e",
  grounding_dino: "#f59e0b",
};

const map = L.map("map");
const esri = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  { maxZoom: 20, attribution: "Esri World Imagery" }
);
const osm = L.tileLayer(
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  { maxZoom: 19, attribution: "© OpenStreetMap" }
);
esri.addTo(map);
L.control.layers({ "Esri Imagery": esri, "OSM": osm }, {}).addTo(map);

const counts = {};
const layer = L.geoJSON(FEATURES, {
  pointToLayer: (f, latlng) => {
    const src = (f.properties || {}).source || "unknown";
    counts[src] = (counts[src] || 0) + 1;
    return L.circleMarker(latlng, {
      radius: 5,
      color: "#000",
      weight: 1,
      fillColor: COLORS[src] || "#888",
      fillOpacity: 0.85,
    });
  },
  onEachFeature: (f, lyr) => {
    const p = f.properties || {};
    const score = p.score != null
      ? ` <span style="opacity:0.6">(${(p.score * 100).toFixed(0)}%)</span>`
      : "";
    const tags = p.tags
      ? `<div class="popup-tags">${JSON.stringify(p.tags, null, 2)}</div>`
      : "";
    lyr.bindPopup(
      `<b>${p.kind || "?"}</b>${score}<br>` +
      `<small style="opacity:0.7">${p.source || ""}</small>${tags}`
    );
  },
}).addTo(map);

if (FEATURES.features && FEATURES.features.length) {
  map.fitBounds(layer.getBounds(), { padding: [24, 24] });
} else if (FEATURES.bbox) {
  const [w, s, e, n] = FEATURES.bbox;
  map.fitBounds([[s, w], [n, e]]);
} else {
  map.setView([0, 0], 2);
}

const legend = L.control({ position: "topright" });
legend.onAdd = () => {
  const div = L.DomUtil.create("div", "legend");
  let html = "<b>satextract</b><br>";
  const all = Object.keys(COLORS);
  for (const src of all) {
    if (counts[src]) {
      html += `<div class="row"><span class="dot" style="background:${COLORS[src]}"></span>${src} (${counts[src]})</div>`;
    }
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  html += `<div style="margin-top:4px;opacity:0.7">${total} feature${total === 1 ? "" : "s"}</div>`;
  div.innerHTML = html;
  return div;
};
legend.addTo(map);
</script>
</body>
</html>
"""


def render(feature_collection, out_path):
    """feature_collection: dict (GeoJSON FeatureCollection) or path to one."""
    if isinstance(feature_collection, str):
        with open(feature_collection) as f:
            fc = json.load(f)
    else:
        fc = feature_collection
    payload = json.dumps(fc, separators=(",", ":"))
    html = _HTML.replace("__FEATURES__", payload)
    with open(out_path, "w") as f:
        f.write(html)
