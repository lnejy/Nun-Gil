import json
import re
import statistics
import sys
import cv2
import numpy as np

from pathlib import Path

import fitz  # PyMuPDF
from paddleocr import PaddleOCR

INPUT_PDF = sys.argv[1] if len(sys.argv) > 1 else "sample.pdf"
OUTPUT_JSON = sys.argv[2] if len(sys.argv) > 2 else "public/demo-layout.json"
DOCLING_JSON = sys.argv[3] if len(sys.argv) > 3 else None

BASE_DIR = Path(__file__).resolve().parent.parent

PAGE_DIR = BASE_DIR / "public" / "demo-pages"
OCR_DIR = BASE_DIR / "public" / "demo-ocr"

_paddle_ocr = None


def get_paddle_ocr():
    global _paddle_ocr

    if _paddle_ocr is None:
        _paddle_ocr = PaddleOCR(
            lang="korean",
            use_doc_orientation_classify=False,
            use_textline_orientation=False,
            use_doc_unwarping=False,
        )

    return _paddle_ocr


def normalize_text(text):
    return " ".join(str(text or "").split())


def clean_ocr_text(text):
    text = normalize_text(text)
    text = re.sub(r"(?<=[가-힣])\s+(?=[가-힣])", "", text)
    text = re.sub(r"\s+([.,!?;:)\]}>])", r"\1", text)
    text = re.sub(r"([(<{\[])\s+", r"\1", text)
    return text.strip()


def color_to_hex(color):
    return f"#{color & 0xFFFFFF:06x}"


def bbox_union(items):
    x0 = min(i["bbox"][0] for i in items)
    y0 = min(i["bbox"][1] for i in items)
    x1 = max(i["bbox"][2] for i in items)
    y1 = max(i["bbox"][3] for i in items)
    return [x0, y0, x1, y1]


def median_or_default(values, default):
    values = [v for v in values if v is not None]
    return statistics.median(values) if values else default


def is_bold_font(font_name):
    f = (font_name or "").lower()
    return any(k in f for k in ["bold", "black", "heavy", "semibold"])


def text_quality_score(text):
    text = clean_ocr_text(text)

    if not text:
        return 0

    visible = re.sub(r"\s+", "", text)

    if not visible:
        return 0

    korean = len(re.findall(r"[가-힣]", text))
    latin = len(re.findall(r"[a-zA-Z]", text))
    digit = len(re.findall(r"[0-9]", text))
    symbols = len(re.findall(r"[^가-힣a-zA-Z0-9\s]", text))

    total = len(visible)
    readable = korean + latin + digit

    if total <= 1:
        return 0.1

    symbol_ratio = symbols / max(total, 1)
    readable_ratio = readable / max(total, 1)

    if korean == 0 and latin <= 2 and digit == 0:
        return 0.1

    if symbol_ratio > 0.6:
        return 0.1

    if readable_ratio < 0.35:
        return 0.2

    score = readable_ratio

    if korean >= 2:
        score += 0.25

    if korean >= 8:
        score += 0.15

    return round(max(0, min(1, score)), 2)


def is_meaningful_search_text(text):
    text = clean_ocr_text(text)

    if len(text) < 2:
        return False

    garbage = {
        ".", ",", ":", ";", "()", "( )", "→", "↑", "•", "-", "—",
        "|", "/", "\\", "<", ">", "»", "》", "「", "」", "“", "”",
        "'", '"', "_", "="
    }

    if text in garbage:
        return False

    korean = len(re.findall(r"[가-힣]", text))
    latin = len(re.findall(r"[a-zA-Z]", text))
    digit = len(re.findall(r"[0-9]", text))
    english_words = re.findall(r"\b[a-zA-Z]{3,}\b", text)

    if korean >= 2:
        return text_quality_score(text) >= 0.45

    if latin >= 3 and english_words:
        return text_quality_score(text) >= 0.45

    if digit >= 2 and korean + latin == 0:
        return False

    return False


def save_page_background(page, page_num, scale=2):
    PAGE_DIR.mkdir(parents=True, exist_ok=True)

    pix = page.get_pixmap(
        matrix=fitz.Matrix(scale, scale),
        alpha=False,
    )

    name = f"page_{page_num}.png"
    path = PAGE_DIR / name
    pix.save(str(path))

    print(f"[BG SAVED] {path}")

    return f"/demo-pages/{name}"


def render_page_for_ocr(page, page_num, scale=2):
    OCR_DIR.mkdir(parents=True, exist_ok=True)
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
    name = f"page_{page_num}_ocr.png"
    path = OCR_DIR / name
    pix.save(str(path))
    return path


def extract_lines(page):
    raw = page.get_text("dict", sort=True)
    lines = []

    for raw_block in raw.get("blocks", []):
        if raw_block.get("type") != 0:
            continue

        for raw_line in raw_block.get("lines", []):
            spans = []
            parts = []
            bbox = None
            sizes = []
            fonts = []

            for span in raw_line.get("spans", []):
                text = span.get("text", "")

                if not text.strip():
                    continue

                x0, y0, x1, y1 = span["bbox"]
                size = float(span.get("size", 12))
                font = span.get("font", "")

                spans.append({
                    "text": text,
                    "x": x0,
                    "y": y0,
                    "width": x1 - x0,
                    "height": y1 - y0,
                    "fontSize": size,
                    "font": font,
                    "color": color_to_hex(span.get("color", 0)),
                })

                parts.append(text)
                sizes.append(size)
                fonts.append(font)

                if bbox is None:
                    bbox = [x0, y0, x1, y1]
                else:
                    bbox = [
                        min(bbox[0], x0),
                        min(bbox[1], y0),
                        max(bbox[2], x1),
                        max(bbox[3], y1),
                    ]

            if not spans or not bbox:
                continue

            text = "".join(parts).strip()

            if not text:
                continue

            bold_ratio = sum(1 for f in fonts if is_bold_font(f)) / max(len(fonts), 1)

            lines.append({
                "text": text,
                "normText": normalize_text(text),
                "bbox": bbox,
                "x": bbox[0],
                "y": bbox[1],
                "width": bbox[2] - bbox[0],
                "height": bbox[3] - bbox[1],
                "fontSize": max(sizes) if sizes else 12,
                "boldRatio": bold_ratio,
                "spans": spans,
            })

    lines = sorted(lines, key=lambda l: (round(l["y"], 1), l["x"]))

    return merge_same_visual_lines(lines)


def merge_same_visual_lines(lines):
    if not lines:
        return []

    merged = []
    current = [lines[0]]

    for line in lines[1:]:
        prev = current[-1]

        same_y = abs(line["y"] - prev["y"]) <= max(prev["fontSize"] * 0.45, 4)
        close_x = line["x"] - prev["bbox"][2] <= max(prev["fontSize"] * 4.5, 45)

        if same_y and close_x:
            current.append(line)
        else:
            merged.append(merge_line_group(current))
            current = [line]

    if current:
        merged.append(merge_line_group(current))

    return merged


def merge_line_group(group):
    group = sorted(group, key=lambda l: l["x"])
    bbox = bbox_union(group)
    text = "".join(l["text"] for l in group)

    spans = []

    for line in group:
        spans.extend(line["spans"])

    return {
        "text": text,
        "normText": normalize_text(text),
        "bbox": bbox,
        "x": bbox[0],
        "y": bbox[1],
        "width": bbox[2] - bbox[0],
        "height": bbox[3] - bbox[1],
        "fontSize": max(l["fontSize"] for l in group),
        "boldRatio": sum(l.get("boldRatio", 0) for l in group) / max(len(group), 1),
        "spans": spans,
    }


def group_by_page_lines(lines):
    pages = {}

    for line in lines:
        pages.setdefault(line["page"], []).append(line)

    return pages


def build_doc_profile(all_lines):
    font_sizes = [round(l["fontSize"], 1) for l in all_lines if l["fontSize"] > 0]
    body_font = median_or_default(font_sizes, 10)

    gaps = []

    for page_lines in group_by_page_lines(all_lines).values():
        for a, b in zip(page_lines, page_lines[1:]):
            gap = b["y"] - (a["y"] + a["height"])

            if 0 <= gap < 80:
                gaps.append(gap)

    body_gap = median_or_default(gaps, body_font * 0.6)
    widths = [l["width"] for l in all_lines if l["width"] > 20]
    body_width = median_or_default(widths, 300)

    return {
        "bodyFontSize": body_font,
        "bodyLineGap": body_gap,
        "bodyLineWidth": body_width,
    }


def classify_heading(line, profile):
    text = line["normText"].strip()

    if not text:
        return False

    body_font = profile["bodyFontSize"]
    font_size = line["fontSize"]
    bold_ratio = line.get("boldRatio", 0)
    width = line.get("width", 0)

    if len(text) > 90:
        return False

    if font_size >= body_font * 1.35:
        return True

    if bold_ratio >= 0.75 and len(text) <= 55 and width < profile["bodyLineWidth"] * 1.3:
        return True

    return False


def list_likeness(line):
    t = line["normText"].strip()

    if not t:
        return False

    if t.startswith(("-", "•", "·", "*", "》", ">")):
        return True

    if re.match(r"^\d+\)\s+.+", t):
        return True

    return False


def make_block(page_num, block_type, lines):
    bbox = bbox_union(lines)

    return {
        "block_id": "",
        "type": block_type,
        "page": page_num,
        "bbox": bbox,
        "x": bbox[0],
        "y": bbox[1],
        "width": bbox[2] - bbox[0],
        "height": bbox[3] - bbox[1],
        "text": " ".join(l["normText"] for l in lines).strip(),
        "spans": [s for l in lines for s in l["spans"]],
    }


def segment_lines(page_num, lines, profile):
    blocks = []
    current = []

    def flush():
        nonlocal current

        if not current:
            return

        if len(current) == 1 and classify_heading(current[0], profile):
            btype = "heading"
        elif all(list_likeness(l) for l in current):
            btype = "list"
        else:
            btype = "paragraph"

        blocks.append(make_block(page_num, btype, current))
        current = []

    for line in lines:
        if classify_heading(line, profile):
            flush()
            blocks.append(make_block(page_num, "heading", [line]))
            continue

        if list_likeness(line):
            flush()
            blocks.append(make_block(page_num, "list", [line]))
            continue

        if not current:
            current = [line]
            continue

        prev = current[-1]
        gap_y = line["y"] - (prev["y"] + prev["height"])
        same_column = abs(line["x"] - current[0]["x"]) < 65

        if gap_y > max(profile["bodyLineGap"] * 3.2, 28) or not same_column:
            flush()
            current = [line]
        else:
            current.append(line)

    flush()

    return blocks


def load_docling_blocks(docling_json_path):
    if not docling_json_path:
        return []

    path = Path(docling_json_path)

    if not path.exists():
        return []

    data = json.loads(path.read_text(encoding="utf-8"))
    doc = data.get("json", data)

    result = []

    for item in doc.get("texts", []):
        prov = item.get("prov") or []

        if not prov:
            continue

        p = prov[0]

        result.append({
            "page": p.get("page_no"),
            "label": item.get("label"),
            "text": item.get("text") or item.get("orig") or "",
            "bbox": p.get("bbox"),
            "self_ref": item.get("self_ref"),
        })

    return result


def normalize_for_match(value):
    return re.sub(r"\s+", "", str(value or "")).lower()


def text_similarity(a, b):
    if not a or not b:
        return 0

    if a in b or b in a:
        return 1.0

    a_set = set(a)
    b_set = set(b)

    return len(a_set & b_set) / max(len(a_set | b_set), 1)


def find_best_docling_match(block, docling_blocks):
    page = block.get("page")
    text = normalize_for_match(block.get("text", ""))

    if not text:
        return None

    candidates = [
        d for d in docling_blocks
        if d.get("page") == page and d.get("text")
    ]

    best = None
    best_score = 0

    for d in candidates:
        d_text = normalize_for_match(d["text"])
        score = text_similarity(text, d_text)

        if score > best_score:
            best = d
            best_score = score

    return best if best_score >= 0.45 else None


def apply_docling_labels(blocks, docling_blocks):
    for block in blocks:
        best = find_best_docling_match(block, docling_blocks)

        if not best:
            continue

        label = best.get("label")

        if label == "section_header":
            block["type"] = "heading"
        elif label == "code":
            block["type"] = "code"
        elif label == "list_item":
            block["type"] = "list"
        elif label == "text":
            block["type"] = "paragraph"

        block["doclingLabel"] = label

    return blocks


def assign_block_ids(blocks, page_num, start_index):
    idx = start_index

    for block in blocks:
        if block.get("block_id"):
            continue

        prefix = {
            "heading": "h",
            "paragraph": "p",
            "list": "li",
            "code": "code",
            "textOverlay": "txt",
            "regionOverlay": "region",
            "visualRegion": "visual",
        }.get(block["type"], "b")

        block["block_id"] = f"p{page_num}-{prefix}{idx}"
        idx += 1

    return idx


def to_text_overlays(blocks):
    overlays = []

    for b in blocks:
        text = b.get("text", "").strip()

        if not text:
            continue

        q = text_quality_score(text)

        overlays.append({
            "block_id": b.get("block_id", ""),
            "type": "textOverlay",
            "page": b["page"],
            "x": b["x"],
            "y": b["y"],
            "width": b["width"],
            "height": b["height"],
            "bbox": b["bbox"],
            "text": text,
            "cleanText": clean_ocr_text(text),
            "source": "native",
            "confidence": q,
            "textQuality": q,
            "label": b.get("type"),
            "doclingLabel": b.get("doclingLabel"),
        })

    return overlays


def parse_paddle_result(result):
    items = []

    if not result:
        return items

    for res in result:
        if hasattr(res, "json"):
            data = res.json
            if isinstance(data, dict):
                data = data.get("res", data)

            texts = data.get("rec_texts", [])
            scores = data.get("rec_scores", [])
            boxes = data.get("rec_polys") or data.get("dt_polys") or []

            for box, text, score in zip(boxes, texts, scores):
                items.append((box, (text, score)))

        elif isinstance(res, dict):
            data = res.get("res", res)
            texts = data.get("rec_texts", [])
            scores = data.get("rec_scores", [])
            boxes = data.get("rec_polys") or data.get("dt_polys") or []

            for box, text, score in zip(boxes, texts, scores):
                items.append((box, (text, score)))

        elif isinstance(res, list):
            for item in res:
                items.append(item)

    return items


def run_page_ocr_boxes(page, page_num, scale=3):
    image_path = render_page_for_ocr(page, page_num, scale=scale)
    ocr = get_paddle_ocr()

    line_barriers = detect_line_barriers(image_path, scale)
    table_regions = detect_table_regions(image_path, scale)

    try:
        result = ocr.predict(str(image_path))
    except AttributeError:
        result = ocr.ocr(str(image_path))

    items = parse_paddle_result(result)
    overlays = []

    for i, item in enumerate(items):
        try:
            box, rec = item
            text, conf = rec
        except Exception:
            continue

        text = clean_ocr_text(text)

        if not text:
            continue

        try:
            conf = float(conf)
        except Exception:
            conf = 0

        box = [[float(p[0]), float(p[1])] for p in box]

        xs = [p[0] / scale for p in box]
        ys = [p[1] / scale for p in box]

        x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)

        if x1 - x0 < 2 or y1 - y0 < 2:
            continue

        w = x1 - x0
        h = y1 - y0

        overlays.append({
            "block_id": f"p{page_num}-paddle-{i}",
            "type": "textOverlay",
            "page": page_num,
            "x": x0,
            "y": y0,
            "width": w,
            "height": h,
            "bbox": [x0, y0, x1, y1],
            "text": text,
            "cleanText": text,
            "source": "paddleocr",
            "confidence": conf,
            "textQuality": text_quality_score(text),
        })

    print("=" * 60)
    print(f"PAGE {page_num}")

    for o in overlays[:15]:
        print(o["text"], o["confidence"])

    whitespace_barriers = detect_whitespace_barriers(
        page.rect.width,
        page.rect.height,
        overlays,
    )

    barriers = line_barriers + whitespace_barriers

    merged = merge_nearby_ocr_lines(
        overlays,
        page_num,
        barriers=barriers,
        page_width=page.rect.width,
    )

    for i, t in enumerate(table_regions, start=1):
        t["page"] = page_num
        t["block_id"] = f"p{page_num}-table-{i}"

    return merged + table_regions

def bbox_intersects(a, b, pad=0):
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    return not (
        ax1 + pad < bx0
        or bx1 + pad < ax0
        or ay1 + pad < by0
        or by1 + pad < ay0
    )


def overlap_ratio(a, b):
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b

    ix0, iy0 = max(ax0, bx0), max(ay0, by0)
    ix1, iy1 = min(ax1, bx1), min(ay1, by1)

    if ix1 <= ix0 or iy1 <= iy0:
        return 0

    inter = (ix1 - ix0) * (iy1 - iy0)
    aa = max((ax1 - ax0) * (ay1 - ay0), 1)
    bb = max((bx1 - bx0) * (by1 - by0), 1)

    return inter / min(aa, bb)


def merge_overlapping_regions(regions, iou_threshold=0.35):
    if not regions:
        return []

    regions = sorted(
        regions,
        key=lambda r: (
            (r["bbox"][2] - r["bbox"][0])
            * (r["bbox"][3] - r["bbox"][1])
        ),
        reverse=True,
    )

    kept = []

    for r in regions:
        if all(overlap_ratio(r["bbox"], k["bbox"]) < iou_threshold for k in kept):
            kept.append(r)

    return kept


def count_line_components(mask, orientation):
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    count = 0
    h, w = mask.shape

    for c in contours:
        x, y, bw, bh = cv2.boundingRect(c)

        if orientation == "vertical":
            if bh > h * 0.25 and bw < max(10, w * 0.08):
                count += 1

        if orientation == "horizontal":
            if bw > w * 0.25 and bh < max(10, h * 0.08):
                count += 1

    return count


def detect_line_barriers(image_path, scale):
    img = cv2.imread(str(image_path))
    if img is None:
        return []

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, 215, 255, cv2.THRESH_BINARY_INV)

    h, w = binary.shape
    barriers = []

    vertical_kernel = cv2.getStructuringElement(
        cv2.MORPH_RECT,
        (3, max(24, h // 14)),
    )
    vertical = cv2.morphologyEx(binary, cv2.MORPH_OPEN, vertical_kernel)

    contours, _ = cv2.findContours(vertical, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    for c in contours:
        x, y, bw, bh = cv2.boundingRect(c)

        if bh >= h * 0.12 and bw <= max(12, w * 0.025):
            barriers.append({
                "type": "verticalLine",
                "x": x / scale,
                "y": y / scale,
                "width": bw / scale,
                "height": bh / scale,
                "bbox": [x / scale, y / scale, (x + bw) / scale, (y + bh) / scale],
                "source": "opencv",
            })

    horizontal_kernel = cv2.getStructuringElement(
        cv2.MORPH_RECT,
        (max(24, w // 14), 3),
    )
    horizontal = cv2.morphologyEx(binary, cv2.MORPH_OPEN, horizontal_kernel)

    contours, _ = cv2.findContours(horizontal, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    for c in contours:
        x, y, bw, bh = cv2.boundingRect(c)

        if bw >= w * 0.12 and bh <= max(12, h * 0.025):
            barriers.append({
                "type": "horizontalLine",
                "x": x / scale,
                "y": y / scale,
                "width": bw / scale,
                "height": bh / scale,
                "bbox": [x / scale, y / scale, (x + bw) / scale, (y + bh) / scale],
                "source": "opencv",
            })

    return merge_overlapping_regions(barriers, iou_threshold=0.45)


def detect_table_regions(image_path, scale):
    img = cv2.imread(str(image_path))
    if img is None:
        return []

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, 215, 255, cv2.THRESH_BINARY_INV)

    h, w = binary.shape

    vertical_kernel = cv2.getStructuringElement(
        cv2.MORPH_RECT,
        (2, max(12, h // 35)),
    )
    horizontal_kernel = cv2.getStructuringElement(
        cv2.MORPH_RECT,
        (max(12, w // 35), 2),
    )

    vertical = cv2.morphologyEx(binary, cv2.MORPH_OPEN, vertical_kernel)
    horizontal = cv2.morphologyEx(binary, cv2.MORPH_OPEN, horizontal_kernel)

    table_mask = cv2.add(vertical, horizontal)
    table_mask = cv2.dilate(
        table_mask,
        cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9)),
        iterations=2,
    )

    contours, _ = cv2.findContours(table_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    regions = []
    page_area = w * h

    for c in contours:
        x, y, bw, bh = cv2.boundingRect(c)
        area = bw * bh

        if area < page_area * 0.01:
            continue

        if bw < w * 0.12 or bh < h * 0.05:
            continue

        roi_v = vertical[y:y + bh, x:x + bw]
        roi_h = horizontal[y:y + bh, x:x + bw]

        v_count = count_line_components(roi_v, "vertical")
        h_count = count_line_components(roi_h, "horizontal")

        if v_count >= 2 and h_count >= 2:
            regions.append({
                "block_id": "",
                "type": "tableRegion",
                "page": None,
                "x": x / scale,
                "y": y / scale,
                "width": bw / scale,
                "height": bh / scale,
                "bbox": [x / scale, y / scale, (x + bw) / scale, (y + bh) / scale],
                "text": "",
                "source": "opencv-table",
                "confidence": 0.7,
                "vLines": v_count,
                "hLines": h_count,
            })

    return merge_overlapping_regions(regions, iou_threshold=0.25)


def detect_whitespace_barriers(page_width, page_height, boxes):
    if not boxes:
        return []

    barriers = []

    intervals = sorted([(b["bbox"][0], b["bbox"][2]) for b in boxes])
    merged = []

    for x0, x1 in intervals:
        if not merged or x0 > merged[-1][1]:
            merged.append([x0, x1])
        else:
            merged[-1][1] = max(merged[-1][1], x1)

    min_gap = page_width * 0.055
    prev = 0

    for x0, x1 in merged:
        gap = x0 - prev

        if gap >= min_gap and 20 < prev < page_width - 20:
            barriers.append({
                "type": "verticalWhitespace",
                "x": prev,
                "y": 0,
                "width": gap,
                "height": page_height,
                "bbox": [prev, 0, x0, page_height],
                "source": "whitespace",
            })

        prev = max(prev, x1)

    return barriers


def has_visual_barrier_between(a, b, barriers):
    ax0, ay0, ax1, ay1 = a["bbox"]
    bx0, by0, bx1, by1 = b["bbox"]

    same_row = not (ay1 < by0 or by1 < ay0)

    if same_row:
        left = min(ax1, bx1)
        right = max(ax0, bx0)
        top = max(ay0, by0) - 4
        bottom = min(ay1, by1) + 4

        for barrier in barriers:
            if not barrier["type"].startswith("vertical"):
                continue

            x0, y0, x1, y1 = barrier["bbox"]
            cx = (x0 + x1) / 2

            barrier_between = left <= cx <= right
            vertical_overlap = not (y1 < top or y0 > bottom)

            if barrier_between and vertical_overlap:
                return True

    same_col = not (ax1 < bx0 or bx1 < ax0)

    if same_col:
        left = max(ax0, bx0) - 4
        right = min(ax1, bx1) + 4
        top = min(ay1, by1)
        bottom = max(ay0, by0)

        for barrier in barriers:
            if not barrier["type"].startswith("horizontal"):
                continue

            x0, y0, x1, y1 = barrier["bbox"]
            cy = (y0 + y1) / 2

            barrier_between = top <= cy <= bottom
            horizontal_overlap = not (x1 < left or x0 > right)

            if barrier_between and horizontal_overlap:
                return True

    return False



def merge_nearby_ocr_lines(lines, page_num, barriers=None, page_width=None):
    if not lines:
        return []

    barriers = barriers or []

    lines = sorted(lines, key=lambda l: (round(l["y"] / 8), l["x"]))

    merged = []
    current = [lines[0]]

    for line in lines[1:]:
        prev = current[-1]

        same_line = abs(line["y"] - prev["y"]) <= max(prev["height"] * 0.5, 6)

        gap_x = line["x"] - (prev["x"] + prev["width"])
        close_x = gap_x <= 25

        large_column_gap = gap_x > max(prev["height"] * 2.2, 32)

        cross_mid = (
            page_width is not None
            and prev["x"] < page_width * 0.5 < line["x"]
        )

        overlap_y = not (
            line["bbox"][1] > prev["bbox"][3]
            or line["bbox"][3] < prev["bbox"][1]
        )

        blocked = has_visual_barrier_between(prev, line, barriers)

        if (
            (same_line or overlap_y)
            and close_x
            and not blocked
            and not large_column_gap
            and not cross_mid
        ):
            current.append(line)
        else:
            merged.append(merge_overlay_group(current, page_num, len(merged) + 1))
            current = [line]

    if current:
        merged.append(merge_overlay_group(current, page_num, len(merged) + 1))

    return merged

def merge_overlay_group(group, page_num, idx):
    group = sorted(group, key=lambda g: g["x"])
    bbox = bbox_union(group)
    text = clean_ocr_text(" ".join(g["text"] for g in group))
    confidence = sum(g.get("confidence", 0) for g in group) / max(len(group), 1)

    return {
        "block_id": f"p{page_num}-paddle-line-{idx}",
        "type": "textOverlay",
        "page": page_num,
        "x": bbox[0],
        "y": bbox[1],
        "width": bbox[2] - bbox[0],
        "height": bbox[3] - bbox[1],
        "bbox": bbox,
        "text": text,
        "cleanText": text,
        "source": "paddleocr",
        "confidence": round(confidence, 3),
        "textQuality": text_quality_score(text),
    }

def make_visual_regions(page, page_num):
    return []

def make_region_grid(page, page_num, rows=3, cols=4):
    overlays = []
    cell_w = page.rect.width / cols
    cell_h = page.rect.height / rows

    for r in range(rows):
        for c in range(cols):
            x = c * cell_w
            y = r * cell_h

            overlays.append({
                "block_id": f"p{page_num}-region-{r}-{c}",
                "type": "regionOverlay",
                "page": page_num,
                "x": x,
                "y": y,
                "width": cell_w,
                "height": cell_h,
                "bbox": [x, y, x + cell_w, y + cell_h],
                "text": "",
                "source": "grid",
                "confidence": 0,
            })

    return overlays


def looks_like_broken_native_text_page(native_overlays):
    if len(native_overlays) < 8:
        return False

    garbage_values = {
        ".", ",", "()", "( )", "→", "↑", "•", ": “", ")", "(", ",↑",
    }

    garbage_count = 0
    short_count = 0

    for o in native_overlays:
        text = normalize_text(o.get("text", ""))

        if text in garbage_values:
            garbage_count += 1

        if len(re.sub(r"\s+", "", text)) <= 2:
            short_count += 1

    return garbage_count >= 4 or short_count / max(len(native_overlays), 1) >= 0.55


def create_chunks(overlays, page_num, chunk_index):
    chunks = []

    for block in overlays:
        if block["type"] in ("regionOverlay", "visualRegion", "tableRegion"):
            continue

        text = clean_ocr_text(block.get("cleanText") or block.get("text", ""))

        if not is_meaningful_search_text(text):
            continue

        quality = text_quality_score(text)
        confidence = block.get("confidence", 0)

        if block.get("source") == "paddleocr" and confidence < 0.45:
            continue

        chunks.append({
            "chunk_id": f"c{chunk_index:04d}",
            "block_id": block["block_id"],
            "type": block["type"],
            "page": page_num,
            "text": text,
            "textQuality": quality,
            "useForSearch": True,
            "source": block.get("source"),
            "confidence": confidence,
        })

        chunk_index += 1

    return chunks, chunk_index


def analyze_pdf(pdf_path, docling_json_path=None):
    doc = fitz.open(pdf_path)
    docling_blocks = load_docling_blocks(docling_json_path)

    all_lines = []

    for page_num, page in enumerate(doc, start=1):
        page_lines = extract_lines(page)

        for line in page_lines:
            line["page"] = page_num

        all_lines.extend(page_lines)

    profile = build_doc_profile(all_lines)

    pages = []
    chunks = []

    block_index = 1
    chunk_index = 1

    lines_by_page = group_by_page_lines(all_lines)

    for page_num, page in enumerate(doc, start=1):
        background = save_page_background(page, page_num, scale=2)
        
        text_blocks = segment_lines(
            page_num,
            lines_by_page.get(page_num, []),
            profile,
        )

        if docling_blocks:
            text_blocks = apply_docling_labels(text_blocks, docling_blocks)

        block_index = assign_block_ids(text_blocks, page_num, block_index)

        native_overlays = to_text_overlays(text_blocks)

        native_text = " ".join(o.get("text", "") for o in native_overlays)
        native_quality = text_quality_score(native_text)

        good_native_count = sum(
            1 for o in native_overlays
            if is_meaningful_search_text(o.get("text", ""))
            and o.get("textQuality", 0) >= 0.45
        )

        broken_native = looks_like_broken_native_text_page(native_overlays)

        if good_native_count >= 3 and native_quality >= 0.45 and not broken_native:
            overlays = native_overlays
            overlay_source = "native"
        else:
            ocr_overlays = run_page_ocr_boxes(page, page_num, scale=2)

            ocr_total_text = clean_ocr_text(
                " ".join(o.get("text", "") for o in ocr_overlays)
            )

            korean_chars = len(re.findall(r"[가-힣]", ocr_total_text))
            latin_chars = len(re.findall(r"[a-zA-Z]", ocr_total_text))
            total_chars = len(re.sub(r"\s+", "", ocr_total_text))

            readable_chars = korean_chars + latin_chars
            readable_ratio = readable_chars / max(total_chars, 1)

            ocr_good_count = sum(
                1 for o in ocr_overlays
                if is_meaningful_search_text(o.get("text", ""))
                and o.get("confidence", 0) >= 0.45
            )

            has_text_page = (
                ocr_good_count >= 4
                and readable_ratio >= 0.45
                and (korean_chars >= 15 or latin_chars >= 25)
            )

            if has_text_page or (broken_native and ocr_good_count >= 2):
                overlays = ocr_overlays
                overlay_source = "paddleocr"
            else:
                overlays = make_visual_regions(page, page_num)
                overlay_source = "visual"

        if len(overlays) < 1:
            overlays = []
            overlay_source = "none"

        overlays.sort(key=lambda b: (b["y"], b["x"]))

        page_chunks, chunk_index = create_chunks(overlays, page_num, chunk_index)
        chunks.extend(page_chunks)

        pages.append({
            "page": page_num,
            "width": page.rect.width,
            "height": page.rect.height,
            "background": background,
            "overlaySource": overlay_source,
            "blocks": text_blocks,
            "overlays": overlays,
        })

        print(
            f"page {page_num}: source={overlay_source}, "
            f"blocks={len(text_blocks)}, overlays={len(overlays)}, chunks={len(page_chunks)}"
        )

    return {
        "source": str(pdf_path),
        "page_count": len(pages),
        "profile": profile,
        "pages": pages,
        "chunks": chunks,
    }


def main():
    pdf_path = Path(INPUT_PDF)
    output_path = Path(OUTPUT_JSON)

    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF 파일을 찾을 수 없습니다: {pdf_path}")

    output_path.parent.mkdir(parents=True, exist_ok=True)

    layout = analyze_pdf(str(pdf_path), DOCLING_JSON)

    output_path.write_text(
        json.dumps(layout, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"완료: {output_path}")
    print(f"pages: {layout['page_count']}")
    print(f"chunks: {len(layout['chunks'])}")
    print(f"profile: {layout['profile']}")


if __name__ == "__main__":
    main()