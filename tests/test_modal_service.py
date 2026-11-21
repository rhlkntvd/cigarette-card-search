import importlib.util
import runpy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


@unittest.skipUnless(
    importlib.util.find_spec("modal"), "Requires requirements-modal.txt"
)
class ModalDeploymentTests(unittest.TestCase):
    def test_container_import_does_not_require_repository_files(self):
        source = Path(__file__).resolve().parents[1] / "ml/modal_service.py"
        with tempfile.TemporaryDirectory() as directory:
            script = Path(directory) / "modal_service.py"
            script.write_text(source.read_text())

            with patch("modal.is_local", return_value=False):
                module = runpy.run_path(str(script))

        self.assertIsNone(module["image"])


if __name__ == "__main__":
    unittest.main()
