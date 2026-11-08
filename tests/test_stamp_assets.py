import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from stamp_assets import stamp_dir, stamp_text  # noqa: E402

V = "abc1234-99"


class StampAssetsTests(unittest.TestCase):
    def test_module_imports_get_the_version(self):
        self.assertEqual(stamp_text('import { a } from "./engine.js";', V), f'import {{ a }} from "./engine.js?v={V}";')

    def test_worker_url_gets_the_version(self):
        src = 'new Worker(new URL("finder.worker.js", import.meta.url), { type: "module" })'
        self.assertIn(f'new URL("finder.worker.js?v={V}", import.meta.url)', stamp_text(src, V))

    def test_data_files_get_the_version(self):
        src = "getJson(fetchFn, `${base}catalog.json`), getJson(fetchFn, `${base}prices.json`)"
        out = stamp_text(src, V)
        self.assertIn(f"`${{base}}catalog.json?v={V}`", out)
        self.assertIn(f"`${{base}}prices.json?v={V}`", out)

    def test_html_script_and_stylesheet_get_the_version(self):
        src = '<link rel="stylesheet" href="styles.css" />\n<script type="module" src="app.js"></script>'
        out = stamp_text(src, V)
        self.assertIn(f'href="styles.css?v={V}"', out)
        self.assertIn(f'src="app.js?v={V}"', out)

    def test_external_urls_untouched(self):
        for src in ['new URL("https://csfloat.com/search")', '<a href="https://x.com/a.js">', 'src="https://cdn.example/app.js"']:
            self.assertEqual(stamp_text(src, V), src)

    def test_stamp_dir_rewrites_html_and_js_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            (d / "app.js").write_text('import "./engine.js";', encoding="utf-8")
            (d / "index.html").write_text('<script src="app.js"></script>', encoding="utf-8")
            (d / "data").mkdir()
            (d / "data" / "prices.json").write_text('{"x": "./engine.js"}', encoding="utf-8")
            changed = stamp_dir(d, V)
            self.assertEqual(sorted(p.name for p in changed), ["app.js", "index.html"])
            self.assertIn(f"engine.js?v={V}", (d / "app.js").read_text(encoding="utf-8"))
            self.assertEqual((d / "data" / "prices.json").read_text(encoding="utf-8"), '{"x": "./engine.js"}')


if __name__ == "__main__":
    unittest.main()
