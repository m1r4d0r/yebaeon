"""Windows-compatible reference checks, for PP6 document comparison."""
from pathlib import Path
import base64
import importlib.util
import json
import unittest
import xml.etree.ElementTree as ET

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



if __name__ == '__main__':
    unittest.main(verbosity=2)
