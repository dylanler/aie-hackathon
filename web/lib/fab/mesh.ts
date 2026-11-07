export interface Triangle {
  normal: [number, number, number];
  verts: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ];
}

export function boxTriangles(size: readonly [number, number, number]): Triangle[] {
  const [x, y, z] = size;
  const v: Array<[number, number, number]> = [
    [0, 0, 0],
    [x, 0, 0],
    [x, y, 0],
    [0, y, 0],
    [0, 0, z],
    [x, 0, z],
    [x, y, z],
    [0, y, z],
  ];
  const faces: Array<[number, number, number]> = [
    [0, 2, 1],
    [0, 3, 2],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [1, 2, 6],
    [1, 6, 5],
    [2, 3, 7],
    [2, 7, 6],
    [3, 0, 4],
    [3, 4, 7],
  ];
  return faces.map(([a, b, c]) => triangle(v[a], v[b], v[c]));
}

function triangle(
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
): Triangle {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const wx = c[0] - a[0];
  const wy = c[1] - a[1];
  const wz = c[2] - a[2];
  let nx = uy * wz - uz * wy;
  let ny = uz * wx - ux * wz;
  let nz = ux * wy - uy * wx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len;
  ny /= len;
  nz /= len;
  return { normal: [nx, ny, nz], verts: [a, b, c] };
}

export function signedMeshVolume(triangles: readonly Triangle[]): number {
  let volume = 0;
  for (const tri of triangles) {
    const [a, b, c] = tri.verts;
    volume +=
      a[0] * (b[1] * c[2] - b[2] * c[1]) -
      a[1] * (b[0] * c[2] - b[2] * c[0]) +
      a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  return volume / 6;
}

export function stlBytes(triangles: readonly Triangle[], name = "part"): Uint8Array {
  const buf = new ArrayBuffer(84 + triangles.length * 50);
  const view = new DataView(buf);
  const header = new TextEncoder().encode(`thought-to-reality ${name}`.slice(0, 80));
  new Uint8Array(buf, 0, 80).set(header);
  view.setUint32(80, triangles.length, true);
  let offset = 84;
  for (const tri of triangles) {
    for (const value of tri.normal) {
      view.setFloat32(offset, value, true);
      offset += 4;
    }
    for (const vert of tri.verts) {
      for (const value of vert) {
        view.setFloat32(offset, value, true);
        offset += 4;
      }
    }
    view.setUint16(offset, 0, true);
    offset += 2;
  }
  return new Uint8Array(buf);
}

export function threeMfBytes(triangles: readonly Triangle[]): Uint8Array {
  const vertices: Array<[number, number, number]> = [];
  const indexOf = new Map<string, number>();
  const faces: Array<[number, number, number]> = [];
  for (const tri of triangles) {
    const ids = tri.verts.map((vert) => {
      const key = vert.map((n) => n.toFixed(5)).join(",");
      const existing = indexOf.get(key);
      if (existing !== undefined) return existing;
      const id = vertices.length;
      vertices.push(vert);
      indexOf.set(key, id);
      return id;
    });
    faces.push([ids[0], ids[1], ids[2]]);
  }
  const vertexXml = vertices
    .map((v) => `<vertex x="${num(v[0])}" y="${num(v[1])}" z="${num(v[2])}"/>`)
    .join("");
  const triangleXml = faces.map((f) => `<triangle v1="${f[0]}" v2="${f[1]}" v3="${f[2]}"/>`).join("");
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <metadata name="Application">Thought to Reality</metadata>
 <resources>
  <object id="1" type="model">
   <mesh>
    <vertices>${vertexXml}</vertices>
    <triangles>${triangleXml}</triangles>
   </mesh>
  </object>
 </resources>
 <build><item objectid="1"/></build>
</model>
`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>
`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
`;
  return zipStore([
    { name: "[Content_Types].xml", data: encode(contentTypes) },
    { name: "_rels/.rels", data: encode(rels) },
    { name: "3D/3dmodel.model", data: encode(model) },
  ]);
}

export function polygonDxf(points: ReadonlyArray<readonly [number, number]>, units: "mm" | "in"): string {
  if (points.length < 3) {
    throw new Error("A DXF outline needs at least 3 points.");
  }
  const insunits = units === "mm" ? 4 : 1;
  const body = points
    .map(([x, y]) => `10\n${num(x)}\n20\n${num(y)}`)
    .join("\n");
  return `0
SECTION
2
HEADER
9
$INSUNITS
70
${insunits}
0
ENDSEC
0
SECTION
2
ENTITIES
0
LWPOLYLINE
8
0
90
${points.length}
70
1
${body}
0
ENDSEC
0
EOF
`;
}

export function rectangleDxf(width: number, height: number, units: "mm" | "in"): string {
  return polygonDxf(
    [
      [0, 0],
      [width, 0],
      [width, height],
      [0, height],
    ],
    units,
  );
}

/** Two larger dimensions form the flat pattern. The smallest is thickness. */
export function flatPatternMm(dims: readonly [number, number, number]): {
  width: number;
  height: number;
  thickness: number;
} {
  const sorted = [...dims].sort((a, b) => a - b);
  return { thickness: sorted[0], height: sorted[1], width: sorted[2] };
}

function num(value: number): string {
  return Number(value.toFixed(5)).toString();
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function zipStore(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encode(file.name);
    const crc = crc32(file.data);
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(file.data.length),
      u32(file.data.length),
      u16(name.length),
      u16(0),
      name,
      file.data,
    ]);
    parts.push(local);
    central.push(
      concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(file.data.length),
        u32(file.data.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]),
    );
    offset += local.length;
  }
  const centralBlob = concat(central);
  const eocd = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralBlob.length),
    u32(offset),
    u16(0),
  ]);
  return concat([...parts, centralBlob, eocd]);
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc ^= data[i];
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (~crc) >>> 0;
}

function u16(value: number): Uint8Array {
  const out = new Uint8Array(2);
  const view = new DataView(out.buffer);
  view.setUint16(0, value, true);
  return out;
}

function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  const view = new DataView(out.buffer);
  view.setUint32(0, value >>> 0, true);
  return out;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
