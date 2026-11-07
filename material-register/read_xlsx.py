"""Read the bounded MaterialEdits_v1 tab without evaluating workbook formulas."""

import datetime as dt
import io
import json
import re
import sys
import xml.etree.ElementTree as ET
import zipfile

TAB = "MaterialEdits_v1"
FIELDS = ("material_id", "topic_id", "title", "revision", "material_type",
          "language", "owner", "status", "effective_date", "file_ref")
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL_ID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
MAX_BYTES = 8 * 1024 * 1024
MAX_ROW = 1001


def xml(book, name):
    with book.open(name) as part:
        data = part.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES or re.search(br"<!DOCTYPE|<!ENTITY", data.replace(b"\0", b""), re.I):
        raise ValueError("Unsupported workbook XML.")
    return ET.fromstring(data)


def rich_text(node):
    return "".join(item.text or "" for item in node.findall(NS + "t") +
                   node.findall(f"{NS}r/{NS}t"))


def address(ref):
    match = re.fullmatch(r"([A-Z]{1,3})([1-9][0-9]{0,6})", ref)
    if not match:
        raise ValueError("Invalid workbook cell address.")
    column = 0
    for letter in match[1]:
        column = column * 26 + ord(letter) - 64
    return int(match[2]), column


def read_tab(data):
    with zipfile.ZipFile(io.BytesIO(data)) as book:
        names = book.namelist()
        if len(names) > 200 or len(set(names)) != len(names):
            raise ValueError("Workbook has too many parts or duplicate parts.")
        workbook = xml(book, "xl/workbook.xml")
        sheets = [sheet for sheet in workbook.findall(f"{NS}sheets/{NS}sheet") if sheet.get("name") == TAB]
        if len(sheets) != 1 or sheets[0].get("state", "visible") != "visible":
            raise ValueError(f"Expected one visible {TAB} tab.")
        rels = xml(book, "xl/_rels/workbook.xml.rels")
        relation = [item for item in rels if item.get("Id") == sheets[0].get(REL_ID)]
        if len(relation) != 1 or relation[0].get("TargetMode", "Internal") != "Internal":
            raise ValueError("Invalid worksheet relationship.")
        target = relation[0].get("Target", "")
        if not re.fullmatch(r"(?:/xl/)?worksheets/[A-Za-z0-9_-]+\.xml", target):
            raise ValueError("Unsupported worksheet path.")
        sheet = xml(book, target.lstrip("/") if target.startswith("/") else "xl/" + target)
        strings = [rich_text(node) for node in xml(book, "xl/sharedStrings.xml")] if "xl/sharedStrings.xml" in names else []
        formats = {}
        styles = []
        if "xl/styles.xml" in names:
            style_sheet = xml(book, "xl/styles.xml")
            formats = {item.get("numFmtId"): item.get("formatCode")
                       for item in style_sheet.findall(f"{NS}numFmts/{NS}numFmt")}
            styles = [item.get("numFmtId") for item in style_sheet.findall(f"{NS}cellXfs/{NS}xf")]
        properties = workbook.find(NS + "workbookPr")
        epoch_1904 = properties is not None and properties.get("date1904") in ("1", "true")

    errors = []
    values = []

    def issue(row, col, message, ref=None):
        errors.append(dict(row=row, field=FIELDS[col - 1] if col <= len(FIELDS) else "row",
                           cell=ref or f"{chr(64 + col)}{row}", message=message))

    for column in sheet.findall(f"{NS}cols/{NS}col"):
        if column.get("hidden") in ("true", "1"):
            for col in range(max(1, int(column.get("min"))), min(len(FIELDS), int(column.get("max"))) + 1):
                issue(1, col, "Unhide this register column.")
    for merge in sheet.findall(f"{NS}mergeCells/{NS}mergeCell"):
        ref = merge.get("ref", "")
        row, col = address(ref.split(":")[0])
        if col <= len(FIELDS):
            issue(row, col, "Unmerge this register range.", ref)

    seen_rows = set()
    for row in sheet.findall(f"{NS}sheetData/{NS}row"):
        number = int(row.get("r", "0"))
        if not 1 <= number <= MAX_ROW or number in seen_rows:
            raise ValueError(f"Register rows must be unique and within 1 to {MAX_ROW}.")
        seen_rows.add(number)
        seen_cols = set()
        cells = [None] * len(FIELDS)
        for cell in row.findall(NS + "c"):
            ref = cell.get("r", "")
            cell_row, col = address(ref)
            if cell_row != number or col in seen_cols:
                raise ValueError("Workbook contains conflicting cell addresses.")
            seen_cols.add(col)
            raw = cell.findtext(NS + "v")
            inline = cell.find(NS + "is")
            formula = cell.find(NS + "f") is not None
            if raw in (None, "") and inline is None and not formula:
                continue
            if col > len(FIELDS):
                issue(number, col, "Remove data beyond the register columns.", ref)
            elif formula:
                issue(number, col, "Replace the formula with a literal value.", ref)
            else:
                kind = cell.get("t", "n")
                if kind == "s" and raw is not None and re.fullmatch(r"[0-9]+", raw):
                    cells[col - 1] = strings[int(raw)]
                elif kind == "inlineStr" and inline is not None:
                    cells[col - 1] = rich_text(inline)
                elif kind == "str":
                    cells[col - 1] = raw
                elif kind == "d" and col == 9 and re.fullmatch(r"\d{4}-\d{2}-\d{2}(?:T00:00:00(?:\.0+)?Z?)?", raw or ""):
                    cells[col - 1] = raw[:10]
                elif kind == "n" and col == 9 and raw and re.fullmatch(r"\d{1,7}(?:\.0+)?", raw):
                    style = int(cell.get("s", "0"))
                    fmt = styles[style] if 0 <= style < len(styles) else None
                    serial = int(raw.split(".")[0])
                    if (fmt in ("14", "15", "16", "17") or formats.get(fmt) == "yyyy-mm-dd") and (
                        epoch_1904 or serial not in (0, 60)
                    ) and serial <= (2957003 if epoch_1904 else 2958465):
                        epoch = dt.date(1904, 1, 1) if epoch_1904 else dt.date(1899, 12, 31)
                        days = serial - (not epoch_1904 and serial > 60)
                        cells[col - 1] = (epoch + dt.timedelta(days=days)).isoformat()
                    else:
                        issue(number, col, "Use a real Excel date or YYYY-MM-DD text.", ref)
                else:
                    issue(number, col, "Use a literal text cell.", ref)
        if row.get("hidden") in ("true", "1") and (number == 1 or any(value is not None for value in cells)):
            errors.append(dict(row=number, field="row", cell=f"A{number}", message="Unhide this register row."))
        while len(values) < number:
            values.append([])
        values[number - 1] = cells
    return dict(sheet=TAB, values=values, errors=errors)


if __name__ == "__main__":
    try:
        source = sys.stdin.buffer.read(MAX_BYTES + 1)
        if len(source) > MAX_BYTES:
            raise ValueError("Workbook exceeds the 8 MiB limit.")
        print(json.dumps(read_tab(source), ensure_ascii=True))
    except (ValueError, KeyError, IndexError, TypeError, OverflowError, ET.ParseError, zipfile.BadZipFile, RuntimeError):
        print(json.dumps(dict(sheet=TAB, values=[], errors=[
            dict(row=0, field="sheet", cell="", message=f"Expected a readable .xlsx with a visible {TAB} tab.")
        ])))
