"""Windows-compatible reference checks, including browser-export integration."""
from pathlib import Path
import base64
import importlib.util
import json
import unittest
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('reference', ROOT / 'tools/pp6-doc-compare-ref.py')
ref = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ref)


class ReferenceTests(unittest.TestCase):
    def decode(self, raw):
        return ref.rtf_to_text_b64(base64.b64encode(raw.encode('ascii')).decode())

    def test_real_document_pair(self):
        required = [ROOT / 'test-pair/local-documents/토요일.pro6',
                    ROOT / 'test-pair/update/documents/토요일.pro6',
                    ROOT / 'test-pair/expected-document-diff.json']
        if not all(path.exists() for path in required):
            self.skipTest('Local church fixtures are not included in GitHub; see README.md.')
        old = ref.parse_document(ROOT / 'test-pair/local-documents/토요일.pro6')
        new = ref.parse_document(ROOT / 'test-pair/update/documents/토요일.pro6')
        report = ref.compare_docs(old, new)
        expected = json.loads((ROOT / 'test-pair/expected-document-diff.json').read_text(encoding='utf-8'))
        self.assertEqual(report['counts'], expected['summary'])
        self.assertEqual(report['groups'], expected['groups'])

    def test_unicode_and_codepage_groups(self):
        self.assertEqual(self.decode(r"{\rtf1\ansi\ansicpg949 \'c7\'d1\'b1\'db}"), '한글')
        self.assertEqual(self.decode(r'{\rtf1\ansi\uc1 \u-10179?\u-8704?\line \u54620?\u44544?}'), '😀\n한글')
        self.assertEqual(self.decode(r'{\rtf1\ansi\ansicpg1252 A{\*\unknown hidden}{\uc0\u54620}\u44544?\tab \\ \{x\}}'), 'A한글\t\\ {x}')
        self.assertEqual(self.decode(r"{\rtf1\ansi\ansicpg1252 \'e9{\ansicpg949 \'c7\'d1}\'e9}"), 'é한é')

    def test_browser_package(self):
        package = ROOT / 'web-editor/test-output/edited-package.zip'
        if not package.exists() or not (ROOT / 'test-pair/update/documents/토요일.pro6').exists():
            self.skipTest('Run web-editor/test-browser.cjs first for export integration.')
        with zipfile.ZipFile(package) as archive:
            self.assertIsNone(archive.testzip())
            xml = archive.read('documents/토요일.pro6')
            root = ET.fromstring(xml)
            self.assertEqual(len(list(root.iter('RVDisplaySlide'))), 39)
            ids = [el.attrib['UUID'] for el in root.iter() if 'UUID' in el.attrib]
            self.assertEqual(len(ids), len(set(ids)))
            texts = [ref.rtf_to_text_b64(el.text) for el in root.iter('NSString') if el.attrib.get('rvXMLIvarName') == 'RTFData']
            self.assertIn('집에서 편집한 한글 😀\n교회에서 최종 확인', texts)
            self.assertIn('새 슬라이드', texts)
            for el in root.iter():
                source = el.attrib.get('source', '')
                if source.startswith('file:///PP6-Package/'):
                    self.assertIn(source[len('file:///PP6-Package/'):], archive.namelist())
            edited = ROOT / 'web-editor/test-output/edited-document.pro6'
            edited.write_bytes(xml)
            before = ref.parse_document(ROOT / 'test-pair/update/documents/토요일.pro6')
            after = ref.parse_document(edited)
            self.assertEqual(ref.compare_docs(before, after)['counts'], dict(added=2, deleted=0, modified=1, moved=0, technical=0))


if __name__ == '__main__':
    unittest.main(verbosity=2)
