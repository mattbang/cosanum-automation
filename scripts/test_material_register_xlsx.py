"""Synthetic acceptance at the native workbook and local review boundary."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "material-register/demo/Training-material-register-template.xlsx"
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
EDITS = "xl/worksheets/sheet2.xml"


def run_cli(*args, code=0):
    result = subprocess.run(
        ["node", str(ROOT / "material-register/cli.mjs"), *map(str, args)], cwd=ROOT,
        capture_output=True, encoding="utf-8", timeout=20,
    )
    if result.returncode != code:
        raise AssertionError(f"Exit {result.returncode}: {result.stderr}\n{result.stdout}")
    return json.loads(result.stdout) if result.stdout else result.stderr


def change_fixture(target, change):
    with ZipFile(TEMPLATE) as source, ZipFile(target, "w") as output:
        sheet = ET.fromstring(source.read(EDITS))
        book = ET.fromstring(source.read("xl/workbook.xml"))
        change(sheet, book)
        changed = {EDITS: ET.tostring(sheet), "xl/workbook.xml": ET.tostring(book)}
        for item in source.namelist():
            output.writestr(item, changed[item] if item in changed else source.read(item))


class MaterialRegisterWorkbookTest(unittest.TestCase):
    def test_preview_stage_readback_and_repeat(self):
        review = run_cli("preview", TEMPLATE)
        self.assertEqual(review["errors"], [])
        self.assertEqual([row["action"] for row in review["rows"]], ["addition", "unchanged", "draft"])
        self.assertEqual(review["rows"][0]["material"]["revision"], "01")
        self.assertEqual(review["rows"][0]["material"]["effective_date"], "2026-11-07")
        with tempfile.TemporaryDirectory() as directory:
            staged = Path(directory) / "staged.json"
            result = run_cli("stage", TEMPLATE, "--review", review["reviewId"], "--reviewer", "Demo review", "--out", staged)
            self.assertEqual(result["appendedRows"], 1)
            catalogue = run_cli("catalogue", "--published", staged, "--as-of", "2026-11-07")
            self.assertEqual(next(row["revision"] for row in catalogue if row["materialId"] == "MAT-D"), "01")
            self.assertFalse(any(row["materialId"] == "MAT-E" for row in catalogue))
            self.assertEqual(run_cli("history", "MAT-A", "01", "--published", staged)["file_ref"], "demo:GUIDE-A-01")
            repeat = run_cli("preview", TEMPLATE, "--published", staged)
            repeat_path = Path(directory) / "repeat.json"
            retried = run_cli("stage", TEMPLATE, "--review", repeat["reviewId"], "--reviewer", "Demo review",
                              "--out", repeat_path, "--published", staged)
            self.assertEqual(retried["appendedRows"], 0)
            self.assertFalse(repeat_path.exists())

    def test_formula_with_cached_value_hidden_column_and_merge_are_rejected(self):
        def invalid(sheet, _book):
            formula_cell = sheet.find(f".//{NS}c[@r='I2']")
            formula_cell.insert(0, ET.Element(NS + "f"))
            formula_cell[0].text = "TODAY()"
            sheet.find(f"{NS}cols/{NS}col[@min='2']").set("hidden", "1")
            merges = ET.SubElement(sheet, NS + "mergeCells", count="1")
            ET.SubElement(merges, NS + "mergeCell", ref="C3:C4")

        with tempfile.TemporaryDirectory() as directory:
            bad = Path(directory) / "bad.xlsx"
            change_fixture(bad, invalid)
            review = run_cli("preview", bad, code=2)
            self.assertIsNone(review["reviewId"])
            self.assertEqual({row["cell"]: row["field"] for row in review["errors"]},
                             {"I2": "effective_date", "B1": "topic_id", "C3:C4": "title"})
            self.assertIn("formula", next(row["message"] for row in review["errors"] if row["cell"] == "I2"))

    def test_excel_1900_and_1904_date_serials(self):
        for epoch, serial in [(False, "40729"), (True, "39267")]:
            with self.subTest(epoch_1904=epoch), tempfile.TemporaryDirectory() as directory:
                def set_serial(sheet, book):
                    if epoch:
                        properties = book.find(NS + "workbookPr")
                        if properties is None:
                            properties = ET.SubElement(book, NS + "workbookPr")
                        properties.set("date1904", "1")
                    cell = sheet.find(f".//{NS}c[@r='I2']")
                    cell.set("t", "n")
                    cell.find(NS + "v").text = serial

                dates = Path(directory) / "dates.xlsx"
                change_fixture(dates, set_serial)
                review = run_cli("preview", dates)
                self.assertEqual(review["rows"][0]["material"]["effective_date"], "2011-07-05")


if __name__ == "__main__":
    unittest.main()
