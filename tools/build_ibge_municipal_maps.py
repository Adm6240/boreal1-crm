#!/usr/bin/env python3
"""Build compact, browser-ready municipal SVG maps from the IBGE shapefile."""

from __future__ import annotations

import argparse
import html
import json
import math
import os
import struct
from pathlib import Path


def read_dbf(path: Path):
    with path.open("rb") as fh:
        header = fh.read(32)
        record_count = struct.unpack_from("<I", header, 4)[0]
        header_length = struct.unpack_from("<H", header, 8)[0]
        record_length = struct.unpack_from("<H", header, 10)[0]
        fields = []
        offset = 1
        while True:
            descriptor = fh.read(32)
            if descriptor[0] == 0x0D:
                break
            name = descriptor[:11].split(b"\0", 1)[0].decode("ascii")
            length = descriptor[16]
            fields.append((name, offset, length))
            offset += length
        fh.seek(header_length)
        wanted = {name: (offset, length) for name, offset, length in fields}
        records = []
        for _ in range(record_count):
            row = fh.read(record_length)
            if not row or row[0] == 0x2A:
                records.append(None)
                continue
            def value(field):
                start, length = wanted[field]
                return row[start:start + length].decode("utf-8", "replace").strip()
            records.append({"code": value("CD_MUN"), "name": value("NM_MUN"), "uf": value("SIGLA_UF")})
        return records


def shape_records(path: Path, with_points=False):
    with path.open("rb") as fh:
        fh.seek(100)
        while True:
            header = fh.read(8)
            if len(header) < 8:
                return
            _, words = struct.unpack(">2i", header)
            content = fh.read(words * 2)
            shape_type = struct.unpack_from("<i", content, 0)[0]
            if shape_type == 0:
                yield None
                continue
            if shape_type != 5:
                raise ValueError(f"Unsupported shape type: {shape_type}")
            bbox = struct.unpack_from("<4d", content, 4)
            if not with_points:
                yield {"bbox": bbox}
                continue
            part_count, point_count = struct.unpack_from("<2i", content, 36)
            part_offset = 44
            point_offset = part_offset + part_count * 4
            parts = list(struct.unpack_from(f"<{part_count}i", content, part_offset)) + [point_count]
            points = [struct.unpack_from("<2d", content, point_offset + i * 16) for i in range(point_count)]
            yield {"bbox": bbox, "rings": [points[parts[i]:parts[i + 1]] for i in range(part_count)]}


def perpendicular_distance(point, start, end):
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    if dx == 0 and dy == 0:
        return math.hypot(point[0] - start[0], point[1] - start[1])
    return abs(dy * point[0] - dx * point[1] + end[0] * start[1] - end[1] * start[0]) / math.hypot(dx, dy)


def rdp(points, tolerance):
    if len(points) <= 2:
        return points
    maximum = 0.0
    index = 0
    for i in range(1, len(points) - 1):
        distance = perpendicular_distance(points[i], points[0], points[-1])
        if distance > maximum:
            maximum = distance
            index = i
    if maximum <= tolerance:
        return [points[0], points[-1]]
    left = rdp(points[:index + 1], tolerance)
    right = rdp(points[index:], tolerance)
    return left[:-1] + right


def simplify_ring(points, tolerance):
    if len(points) < 4:
        return points
    ring = points[:-1] if points[0] == points[-1] else points[:]
    if len(ring) < 4:
        return ring
    anchor = ring[0]
    split = max(range(1, len(ring)), key=lambda i: (ring[i][0] - anchor[0]) ** 2 + (ring[i][1] - anchor[1]) ** 2)
    first = rdp(ring[:split + 1], tolerance)
    second = rdp(ring[split:] + [ring[0]], tolerance)
    result = first[:-1] + second[:-1]
    return result if len(result) >= 3 else ring


def build_maps(shp: Path, dbf: Path, output: Path, tolerance: float):
    attributes = read_dbf(dbf)
    bounds = {}
    municipality_counts = {}
    shape_count = 0
    for index, shape in enumerate(shape_records(shp, with_points=False)):
        shape_count += 1
        attr = attributes[index]
        if not shape or not attr:
            continue
        uf = attr["uf"]
        municipality_counts[uf] = municipality_counts.get(uf, 0) + 1
        minx, miny, maxx, maxy = shape["bbox"]
        current = bounds.setdefault(uf, [minx, miny, maxx, maxy])
        current[0] = min(current[0], minx)
        current[1] = min(current[1], miny)
        current[2] = max(current[2], maxx)
        current[3] = max(current[3], maxy)
    if shape_count != len(attributes):
        raise ValueError(f"Geometry/attribute mismatch: {shape_count} shapes and {len(attributes)} rows")

    output.mkdir(parents=True, exist_ok=True)
    bodies = {uf: (output / f".{uf}.body").open("w", encoding="utf-8") for uf in bounds}
    dimensions = {}
    for uf, (minx, miny, maxx, maxy) in bounds.items():
        dx, dy = maxx - minx, maxy - miny
        scale = 960.0 / max(dx, dy)
        dimensions[uf] = (minx, maxy, scale, dx * scale + 40, dy * scale + 40)

    for index, shape in enumerate(shape_records(shp, with_points=True)):
        attr = attributes[index]
        if not shape or not attr:
            continue
        uf = attr["uf"]
        minx, maxy, scale, _, _ = dimensions[uf]
        path_parts = []
        for ring in shape["rings"]:
            projected = [((x - minx) * scale + 20, (maxy - y) * scale + 20) for x, y in ring]
            simplified = simplify_ring(projected, tolerance)
            if len(simplified) < 3:
                continue
            coords = " ".join(f"{x:.1f},{y:.1f}" for x, y in simplified)
            path_parts.append(f"M {coords} Z")
        if not path_parts:
            continue
        name = html.escape(attr["name"], quote=True)
        code = html.escape(attr["code"], quote=True)
        bodies[uf].write(f'<path data-code="{code}" data-city="{name}" d="{" ".join(path_parts)}"/>\n')

    for fh in bodies.values():
        fh.close()
    for uf in sorted(bounds):
        _, _, _, width, height = dimensions[uf]
        body_path = output / f".{uf}.body"
        body = body_path.read_text(encoding="utf-8")
        svg = (
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.1f} {height:.1f}" '
            f'role="img" aria-labelledby="title-{uf}" data-uf="{uf}" data-municipalities="{municipality_counts[uf]}">'
            f'<title id="title-{uf}">Municípios de {uf}</title><g class="municipalities">{body}</g></svg>'
        )
        (output / f"{uf}.svg").write_text(svg, encoding="utf-8")
        body_path.unlink()

    manifest = {uf: {"municipalities": municipality_counts[uf], "file": f"{uf}.svg"} for uf in sorted(bounds)}
    (output / "index.json").write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return manifest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--tolerance", type=float, default=0.75)
    args = parser.parse_args()
    stem = args.source / "BR_Municipios_2024"
    manifest = build_maps(stem.with_suffix(".shp"), stem.with_suffix(".dbf"), args.output, args.tolerance)
    print(f"Built {len(manifest)} state maps and {sum(v['municipalities'] for v in manifest.values())} municipal areas")


if __name__ == "__main__":
    main()
