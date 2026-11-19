"""OCR a scanned budget PDF into cached word boxes.

Usage:
    python scripts/ocr_pages.py "Budget PDFs - City/2026-Adopted-Budget-2026.pdf" [--dpi 300] [--jobs 8]

For every page this renders the PDF at --dpi, works out which way the page is
turned (Tesseract's orientation detection), rotates it upright, and runs
Tesseract to get one row per word with its pixel box and confidence.

Results are cached under data/ocr_cache/<doc>-<sha256 prefix>/dpi<N>/
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


def file_digest(pdf_path):
    h = hashlib.sha256()
    with open(pdf_path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def cache_dir(pdf_path, dpi):
    return CACHE_ROOT / f"{Path(pdf_path).stem}-{file_digest(pdf_path)[:12]}" / f"dpi{dpi}-{PREPROCESS}"


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


def ocr_page(pdf_path, page_index, dpi, out_dir, fallback_rotate):
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
        upright = erase_rules(upright)
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
    tsv_path.write_text(res.stdout)
    meta_path.write_text(json.dumps({
        "page": page_index + 1, "dpi": dpi, "rotate": rotate,
        "rotate_source": source, "osd_confidence": conf,
        "width": upright.width, "height": upright.height,
    }))
    return page_index, f"rotate {rotate} ({source}, conf {conf:.1f})"


def ocr_document(pdf_path, dpi=300, jobs=None, pages=None, fallback_rotate=90):
    pdf_path = Path(pdf_path)
    out_dir = cache_dir(pdf_path, dpi)
    out_dir.mkdir(parents=True, exist_ok=True)
    with pdfium.PdfDocument(str(pdf_path)) as pdf:
        n_pages = len(pdf)
    indices = [p - 1 for p in pages] if pages else range(n_pages)
    jobs = jobs or max(1, (os.cpu_count() or 2) - 1)
    done = 0
    with ProcessPoolExecutor(max_workers=jobs) as pool:
        futures = [pool.submit(ocr_page, pdf_path, i, dpi, out_dir, fallback_rotate)
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
    args = ap.parse_args()
    out = ocr_document(args.pdf, args.dpi, args.jobs, args.pages, args.fallback_rotate)
    print(f"OCR cache: {out}")


if __name__ == "__main__":
    sys.exit(main())
