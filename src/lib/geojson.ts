import type { Boundary, Pt, Stats } from '../types';

interface GeoJsonFeature {
  type: 'Feature';
  geometry: {
    type: string;
    coordinates: number[][][] | number[][][][];
  };
  properties: Record<string, unknown>;
}

interface GeoJsonFC {
  type: 'FeatureCollection';
  crs?: { type: string; properties: { name: string } };
  features: GeoJsonFeature[];
}

const CRS_NAME = 'urn:ogc:def:crs:EPSG::3857';

function ringToCoords(ring: Pt[], elev?: (p: Pt) => number): number[][] {
  const pts = ring.map((p) => (elev ? [p.x, p.y, Number(elev(p).toFixed(3))] : [p.x, p.y]));
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) pts.push([...first]);
  return pts;
}

/** 导出边界为 GeoJSON FeatureCollection（Polygon 含孔洞；可选贴地高程） */
export function exportBoundaryGeoJSON(
  boundary: Boundary,
  stats: Stats | null,
  elev?: (p: Pt) => number,
): string {
  const polygon: GeoJsonFeature = {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [
        ringToCoords(boundary.outer, elev),
        ...boundary.holes.map((h) => ringToCoords(h, elev)),
      ],
    },
    properties: {
      name: '火烧迹地边界',
      source: 'burn-scar-rebuilder',
      exportedAt: new Date().toISOString(),
      ...(stats
        ? {
            planarArea_m2: Number(stats.planarArea.toFixed(2)),
            surfaceArea_m2: Number(stats.surfaceArea.toFixed(2)),
            perimeter_m: Number(stats.perimeter.toFixed(2)),
            meanSlope_deg: Number(stats.meanSlope.toFixed(2)),
            severityArea_m2: {
              none: Number(stats.levelAreas[0].toFixed(2)),
              light: Number(stats.levelAreas[1].toFixed(2)),
              moderate: Number(stats.levelAreas[2].toFixed(2)),
              heavy: Number(stats.levelAreas[3].toFixed(2)),
              extreme: Number(stats.levelAreas[4].toFixed(2)),
            },
          }
        : {}),
    },
  };

  const fc: GeoJsonFC = {
    type: 'FeatureCollection',
    crs: { type: 'name', properties: { name: CRS_NAME } },
    features: [polygon],
  };
  return JSON.stringify(fc, null, 2);
}

function coordsToRing(coords: number[][]): Pt[] {
  const pts = coords.map((c) => ({ x: c[0], y: c[1] }));
  // 去掉闭合重复点
  if (pts.length > 1) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (a.x === b.x && a.y === b.y) pts.pop();
  }
  return pts;
}

/** 从 GeoJSON 导入边界（支持 Polygon / MultiPolygon） */
export function importBoundaryGeoJSON(text: string): Boundary {
  const fc = JSON.parse(text) as GeoJsonFC | GeoJsonFeature;
  const features = fc.type === 'FeatureCollection' ? fc.features : [fc];
  let outer: Pt[] = [];
  const holes: Pt[][] = [];
  for (const f of features) {
    const g = f.geometry;
    if (g.type === 'Polygon') {
      const polys = g.coordinates as number[][][];
      if (!outer.length && polys.length) outer = coordsToRing(polys[0]);
      for (let i = 1; i < polys.length; i++) holes.push(coordsToRing(polys[i]));
    } else if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates as number[][][][]) {
        if (!outer.length && poly.length) outer = coordsToRing(poly[0]);
        for (let i = 1; i < poly.length; i++) holes.push(coordsToRing(poly[i]));
      }
    }
  }
  if (outer.length < 3) throw new Error('GeoJSON 中未找到有效的 Polygon 边界');
  return { outer, holes };
}

export function downloadText(filename: string, text: string, mime = 'application/geo+json'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
