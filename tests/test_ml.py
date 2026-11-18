import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import torch

from ml import embed_cards, import_pgvector
from ml.common import get_embedding_tensor


class ModelOutputTests(unittest.TestCase):
    def test_accepts_tensor_and_pooler_outputs(self):
        embeddings = torch.ones(2, 768)
        for output in (embeddings, SimpleNamespace(pooler_output=embeddings)):
            with self.subTest(output_type=type(output)):
                self.assertIs(get_embedding_tensor(output, 2), embeddings)

    def test_rejects_missing_or_misaligned_embeddings(self):
        for output in (torch.ones(1, 768), torch.ones(3, 768), torch.ones(768)):
            with self.subTest(shape=output.shape):
                with self.assertRaisesRegex(ValueError, "Expected 2 embedding rows"):
                    get_embedding_tensor(output, 2)

        with self.assertRaises(TypeError):
            get_embedding_tensor(SimpleNamespace(pooler_output=None), 2)

    def test_batch_count_mismatch_retries_without_losing_or_duplicating_cards(self):
        cards = [
            {"dplaId": "first", "title": "First"},
            {"dplaId": "second", "title": "Second"},
        ]
        images = [Mock(), Mock()]
        model = Mock()
        model.parameters.side_effect = lambda: iter([torch.zeros(1)])
        model.get_image_features.side_effect = [
            torch.ones(1, 768),  # Too few rows for the two-image batch.
            torch.ones(1, 768),
            torch.ones(1, 768),
        ]

        with patch.object(
            embed_cards,
            "fetch_batch_images",
            return_value=(images, list(enumerate(cards)), []),
        ), patch("builtins.print"):
            embeddings, metadata, failures, *_ = embed_cards.embed_range(
                cards, 0, 1, 2, 1, Mock(return_value={}), model
            )

        self.assertEqual(len(embeddings), 2)
        self.assertEqual(metadata, cards)
        self.assertEqual(failures, [])
        self.assertEqual(model.get_image_features.call_count, 3)
        for image in images:
            image.close.assert_called_once()


class ImportTests(unittest.TestCase):
    def test_misaligned_artifacts_stop_import_before_connecting_to_database(self):
        for card_count, embedding_count in ((1, 2), (2, 1)):
            with self.subTest(cards=card_count, embeddings=embedding_count):
                with patch.object(import_pgvector, "load_dotenv"), patch.object(
                    import_pgvector, "get_database_url", return_value="unused"
                ), patch.object(
                    import_pgvector, "load_cards", return_value=[{}] * card_count
                ), patch.object(
                    import_pgvector,
                    "load_embeddings",
                    return_value=torch.ones(embedding_count, 768),
                ), patch.object(
                    import_pgvector.psycopg, "connect"
                ) as connect, patch(
                    "builtins.print"
                ):
                    with self.assertRaisesRegex(RuntimeError, "not aligned"):
                        import_pgvector.main()

                connect.assert_not_called()

    def load_tensor(self, tensor):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "embeddings.pt"
            torch.save(tensor, path)
            with patch.object(import_pgvector, "EMBEDDINGS_PATH", path):
                return import_pgvector.load_embeddings()

    def test_accepts_valid_embeddings_and_converts_to_float32(self):
        tensor = torch.ones(2, 768, dtype=torch.float64)
        self.assertTrue(torch.equal(self.load_tensor(tensor), tensor.float()))

    def test_rejects_empty_zero_and_nonfinite_vectors(self):
        cases = [
            (torch.empty(0, 768), "empty"),
            (torch.cat([torch.ones(1, 768), torch.zeros(1, 768)]), "zero vectors"),
            (torch.full((1, 768), float("nan")), "NaN or infinite"),
            (torch.full((1, 768), float("inf")), "NaN or infinite"),
            (torch.full((1, 768), 1e300, dtype=torch.float64), "NaN or infinite"),
        ]
        for tensor, message in cases:
            with self.subTest(message=message):
                with self.assertRaisesRegex(RuntimeError, message):
                    self.load_tensor(tensor)

    def test_rejects_wrong_tensor_shapes(self):
        for tensor in (torch.ones(768), torch.ones(1, 767)):
            with self.subTest(shape=tensor.shape):
                with self.assertRaises(RuntimeError):
                    self.load_tensor(tensor)

    def test_preserves_valid_metadata_and_rejects_malformed_fields(self):
        card = {
            "dplaId": "card-id",
            "nyplUuid": "uuid",
            "title": "Butterfly",
            "frontImageId": "123",
            "sourceUrl": "https://example.test/card",
            "rights": None,
            "displayEligible": False,
        }
        embedding = torch.ones(768)
        row = import_pgvector.make_row(card, embedding)
        self.assertEqual(
            row[:8],
            (
                "card-id",
                "uuid",
                "Butterfly",
                "123",
                None,
                "https://example.test/card",
                None,
                False,
            ),
        )
        invalid_fields = [
            ("dplaId", " "),
            ("nyplUuid", None),
            ("title", 42),
            ("frontImageId", []),
            ("sourceUrl", ""),
            ("displayEligible", "false"),
            ("displayEligible", 0),
            ("rights", " "),
            ("rights", []),
            ("backImageId", None),
        ]
        for field, value in invalid_fields:
            with self.subTest(field=field, value=value):
                with self.assertRaisesRegex(RuntimeError, field):
                    import_pgvector.make_row({**card, field: value}, embedding)

        del card["rights"]
        with self.assertRaisesRegex(RuntimeError, "rights"):
            import_pgvector.make_row(card, embedding)


if __name__ == "__main__":
    unittest.main()
