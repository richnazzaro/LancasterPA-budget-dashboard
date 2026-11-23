"""OCR a scanned budget PDF into cached word boxes.

Usage:
    python scripts/ocr_pages.py "Budget PDFs - City/2026-Adopted-Budget-2026.pdf" [--dpi 300] [--jobs 8]

For every page this renders the PDF at --dpi, works out which way the page is
turned (Tesseract's orientation detection), rotates it upright, and runs
Tesseract to get one row per word with its pixel box and confidence.

Results are cached under data/ocr_cache/<doc>-<sha256 prefix>/dpi<N>-<preprocessing>/
(git-ignored). The hash keeps a replaced or re-trimmed PDF from reusing
another version's pages.
    page_001.tsv   Tesseract TSV for the upright page image
    page_001.json  {"rotate": 90, "osd_confidence": .., "width": .., "height": ..}
Pages already in the cache are skipped, so reruns are instant. Delete the
folder to force a fresh OCR.

Needs the `tesseract` binary (brew install tesseract) and pypdfium2, which
is installed with pdfplumber.
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import pypdfium2 as pdfium
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CACHE_ROOT = ROOT / "data" / "ocr_cache"

# Tesseract page-segmentation mode. 6 = "a single uniform block of text",
# which keeps each printed table row on one OCR line. Column assignment is
# done later from word x-positions, so the OCR line grouping matters little.
PSM = "6"

# Bump when the image preprocessing changes, so old caches are not reused.
PREPROCESS = "rules2"
# The opt-in "clean" preprocessing (clean_scan) caches under its own name;
# bump it when clean_scan or CLEAN_STRETCH changes.
CLEAN = "clean4"
# With "clean", the page is OCR'd stretched this much horizontally, and the
# TSV's x coordinates are mapped back to the page. Tightly kerned digits
# that touch ("2,200" printed with its "00" overlapping, read "2,20") come
# apart: on 10 sample table pages of the 2024 County book, rows whose
# printed variance matches went from 89% to 93% at 1.25 (1.5 and 1.75 do worse).
CLEAN_STRETCH = 1.25


def file_digest(pdf_path):
    h = hashlib.sha256()
    with open(pdf_path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def cache_dir(pdf_path, dpi, clean=False):
    return (CACHE_ROOT / f"{Path(pdf_path).stem}-{file_digest(pdf_path)[:12]}"
            / f"dpi{dpi}-{CLEAN if clean else PREPROCESS}")


def detect_rotation(image_path):
    """Return (clockwise degrees to turn the image upright, confidence)."""
    res = subprocess.run(
        ["tesseract", str(image_path), "-", "--psm", "0"],
        capture_output=True, text=True,
        env={**os.environ, "OMP_THREAD_LIMIT": "1"},
    )
    out = res.stdout + res.stderr
    m_rot = re.search(r"Rotate: (\d+)", out)
    m_conf = re.search(r"Orientation confidence: ([\d.]+)", out)
    if not m_rot:
        return None, 0.0
    return int(m_rot.group(1)), float(m_conf.group(1)) if m_conf else 0.0


def _longest_runs(mask):
    """Longest run of consecutive True values in each column of `mask`."""
    run = np.zeros(mask.shape[1], dtype=np.int32)
    best = np.zeros_like(run)
    for row in mask:
        run = (run + 1) * row
        np.maximum(best, run, out=best)
    return best


def erase_rules(image):
    """Whiten long horizontal and vertical rules (table borders).

    A thick rule touching a TOTAL row makes Tesseract read the row as one
    long garbage word. Only unbroken dark runs count as rules: a quarter of
    the page wide, or a tenth of the page tall. Text is never that long
    without a gap, even where identical rows stack up in a column.
    """
    a = np.asarray(image).copy()
    dark = a < 160
    h, w = dark.shape
    rows = _longest_runs(dark.T) >= 0.25 * w
    cols = _longest_runs(dark) >= 0.10 * h
    a[rows, :] = 255
    a[:, cols] = 255
    return Image.fromarray(a)


def _close(mask, gap, axis):
    """Morphological closing along one axis: bridges gaps of up to `gap` px."""
    n = mask.shape[axis]
    gap = (gap + 1) // 2           # grow and shrink by half the gap each way

    def shifted(s, forward):
        a = [slice(None)] * 2
        b = [slice(None)] * 2
        a[axis] = slice(s, None) if forward else slice(None, n - s)
        b[axis] = slice(None, n - s) if forward else slice(s, None)
        return tuple(a), tuple(b)

    grown = mask.copy()
    for s in range(1, gap + 1):
        a, b = shifted(s, True)
        grown[a] |= mask[b]
        a, b = shifted(s, False)
        grown[a] |= mask[b]
    shrunk = grown.copy()
    for s in range(1, gap + 1):
        a, b = shifted(s, True)
        shrunk[a] &= grown[b]
        a, b = shifted(s, False)
        shrunk[a] &= grown[b]
    return shrunk


def _long_runs(mask, min_len):
    """Pixels of `mask` that lie in a vertical run of at least min_len."""
    out = np.zeros_like(mask)
    run = np.zeros(mask.shape[1], dtype=np.int32)
    for i in range(mask.shape[0] + 1):
        row = mask[i] if i < mask.shape[0] else np.zeros(mask.shape[1], bool)
        for c in np.nonzero(~row & (run >= min_len))[0]:
            out[i - run[c]:i, c] = True
        run = (run + 1) * row
    return out


def clean_scan(image, dpi):
    """Binarise a photocopied page and erase its table rules.

    For scans with show-through from the back of the sheet and dashed,
    broken cell borders (the 2024 County book). Pixels lighter than 140 are
    paper or show-through and go white (Tesseract's own Otsu threshold keeps
    the show-through). Rules are dark runs, after bridging
    gaps of up to 1.5 pt, at least half an inch tall (vertical) or an inch
    wide (horizontal); they are whitened, a pixel either side included. A
    digit or letter is never that long, and the gap between two rows of
    right-aligned digits (about 2.5 pt) is not bridged, so the text stays.
    """
    dark = np.asarray(image) < 140
    gap = round(1.5 * dpi / 72)
    vertical = _long_runs(_close(dark, gap, 0), dpi // 2)
    horizontal = _long_runs(_close(dark, gap, 1).T, dpi).T
    rule = vertical | horizontal
    for axis in (0, 1):
        rule = rule | np.roll(rule, 1, axis) | np.roll(rule, -1, axis)
    return Image.fromarray(np.where(dark & ~rule, 0, 255).astype(np.uint8))


def unstretch_tsv(tsv, stretch):
    """Map a Tesseract TSV's left/width back from a horizontally stretched image."""
    lines = tsv.splitlines()
    head = lines[0].split("\t")
    li, wi = head.index("left"), head.index("width")
    out = [lines[0]]
    for line in lines[1:]:
        f = line.split("\t")
        if len(f) == len(head):
            right = int(f[li]) + int(f[wi])
            f[li] = str(round(int(f[li]) / stretch))
            f[wi] = str(round(right / stretch) - int(f[li]))
        out.append("\t".join(f))
    return "\n".join(out) + "\n"


def ocr_page(pdf_path, page_index, dpi, out_dir, fallback_rotate, clean=False):
    tsv_path = out_dir / f"page_{page_index + 1:03d}.tsv"
    meta_path = out_dir / f"page_{page_index + 1:03d}.json"
    if tsv_path.exists() and meta_path.exists():
        return page_index, "cached"

    pdf = pdfium.PdfDocument(str(pdf_path))
    image = pdf[page_index].render(scale=dpi / 72).to_pil().convert("L")
    pdf.close()

    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / "raw.png"
        image.save(raw, dpi=(dpi, dpi))
        rotate, conf = detect_rotation(raw)
        # Orientation detection is unreliable on near-empty pages; fall back
        # to the document's usual turn when it is unsure.
        if rotate is None or conf < 2.0:
            rotate, source = fallback_rotate, "fallback"
        else:
            source = "osd"
        upright = image.rotate(-rotate, expand=True) if rotate else image
        upright = clean_scan(upright, dpi) if clean else erase_rules(upright)
        stretch = CLEAN_STRETCH if clean else 1
        page_image = upright
        if stretch != 1:
            upright = upright.resize((round(upright.width * stretch), upright.height))
        up = Path(tmp) / "upright.png"
        upright.save(up, dpi=(dpi, dpi))
        res = subprocess.run(
            ["tesseract", str(up), "stdout", "--psm", PSM, "--dpi", str(dpi),
             "-c", "preserve_interword_spaces=1", "tsv"],
            capture_output=True, text=True,
            env={**os.environ, "OMP_THREAD_LIMIT": "1"},
        )
        if res.returncode != 0:
            raise RuntimeError(f"tesseract failed on page {page_index + 1}: {res.stderr}")
    tsv = res.stdout if stretch == 1 else unstretch_tsv(res.stdout, stretch)
    tsv_path.write_text(tsv)
    meta_path.write_text(json.dumps({
        "page": page_index + 1, "dpi": dpi, "rotate": rotate,
        "rotate_source": source, "osd_confidence": conf,
        "width": page_image.width, "height": page_image.height,
        **({"stretch": stretch} if stretch != 1 else {}),
    }))
    return page_index, f"rotate {rotate} ({source}, conf {conf:.1f})"


def ocr_document(pdf_path, dpi=300, jobs=None, pages=None, fallback_rotate=90, clean=False):
    pdf_path = Path(pdf_path)
    out_dir = cache_dir(pdf_path, dpi, clean)
    out_dir.mkdir(parents=True, exist_ok=True)
    with pdfium.PdfDocument(str(pdf_path)) as pdf:
        n_pages = len(pdf)
    indices = [p - 1 for p in pages] if pages else range(n_pages)
    indices = [i for i in indices
               if not (out_dir / f"page_{i + 1:03d}.tsv").exists()
               or not (out_dir / f"page_{i + 1:03d}.json").exists()]
    if not indices:                     # everything cached: no worker pool needed
        return out_dir
    jobs = jobs or max(1, (os.cpu_count() or 2) - 1)
    done = 0
    with ProcessPoolExecutor(max_workers=jobs) as pool:
        futures = [pool.submit(ocr_page, pdf_path, i, dpi, out_dir, fallback_rotate, clean)
                   for i in indices]
        for fut in as_completed(futures):
            i, status = fut.result()
            done += 1
            if status != "cached":
                print(f"[{done}/{len(futures)}] page {i + 1}: {status}", flush=True)
    return out_dir


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("pdf", type=Path)
    ap.add_argument("--dpi", type=int, default=300)
    ap.add_argument("--jobs", type=int)
    ap.add_argument("--pages", type=int, nargs="*", help="1-based page numbers")
    ap.add_argument("--fallback-rotate", type=int, default=90,
                    help="clockwise turn to use when orientation detection is unsure")
    ap.add_argument("--clean", action="store_true",
                    help="binarise and erase broken rules (clean_scan) for show-through scans")
    args = ap.parse_args()
    out = ocr_document(args.pdf, args.dpi, args.jobs, args.pages, args.fallback_rotate, args.clean)
    print(f"OCR cache: {out}")


if __name__ == "__main__":
    sys.exit(main())
