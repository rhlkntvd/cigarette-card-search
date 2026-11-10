import argparse
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import torch

from ml import common, embed_cards


class CheckpointDatasetTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.shards = Path(directory.name) / "shards"
        patched = patch.object(embed_cards, "SHARD_DIR", self.shards)
        patched.start()
        self.addCleanup(patched.stop)
        self.fingerprint = self.shards / "dataset.json"
        self.cards = [
            {"dplaId": "first", "frontImageId": "123", "rights": None},
            {"dplaId": "second", "frontImageId": "456", "rights": None},
        ]

    def test_records_dataset_and_model_for_a_new_run(self):
        embed_cards.check_checkpoint_dataset(self.cards)

        saved = json.loads(self.fingerprint.read_text())
        self.assertEqual(saved["card_count"], 2)
        self.assertEqual(saved["model"], common.MODEL_NAME)
        self.assertEqual(saved["model_revision"], common.MODEL_REVISION)
        self.assertEqual(len(saved["dataset_sha256"]), 64)

    def test_accepts_the_same_cards_with_different_json_key_order(self):
        embed_cards.check_checkpoint_dataset(self.cards)
        embed_cards.save_shard(0, 1, [torch.ones(768), torch.ones(768)], self.cards, [])
        before = self.fingerprint.read_bytes()
        cards = [dict(reversed(list(card.items()))) for card in self.cards]

        embed_cards.check_checkpoint_dataset(cards)

        self.assertEqual(self.fingerprint.read_bytes(), before)
        self.assertEqual(embed_cards.get_resume_index(), 2)

    def test_rejects_changed_order_contents_and_limits_without_replacing_fingerprint(
        self,
    ):
        embed_cards.check_checkpoint_dataset(self.cards)
        before = self.fingerprint.read_bytes()
        cases = [
            list(reversed(self.cards)),
            [{**self.cards[0], "frontImageId": "789"}, self.cards[1]],
            [{**self.cards[0], "rights": "new-rights"}, self.cards[1]],
            self.cards[:1],
            self.cards + [{"dplaId": "third", "frontImageId": "789"}],
        ]

        for cards in cases:
            with self.subTest(cards=cards):
                with self.assertRaisesRegex(RuntimeError, "dataset or model differs"):
                    embed_cards.check_checkpoint_dataset(cards)
                self.assertEqual(self.fingerprint.read_bytes(), before)

    def test_rejects_a_different_model_revision(self):
        embed_cards.check_checkpoint_dataset(self.cards)

        with patch.object(embed_cards, "MODEL_REVISION", "another-revision"):
            with self.assertRaisesRegex(RuntimeError, "dataset or model differs"):
                embed_cards.check_checkpoint_dataset(self.cards)

    def test_leaves_legacy_and_partial_checkpoints_untouched(self):
        self.shards.mkdir()
        for name in ("shard-000000-000001.pt", "shard-000000-000001.pt.tmp"):
            with self.subTest(name=name):
                shard = self.shards / name
                shard.write_bytes(b"existing checkpoint")

                with self.assertRaisesRegex(RuntimeError, "no dataset fingerprint"):
                    embed_cards.check_checkpoint_dataset(self.cards)

                self.assertFalse(self.fingerprint.exists())
                self.assertEqual(shard.read_bytes(), b"existing checkpoint")
                shard.unlink()

    def test_rejects_invalid_fingerprints_without_overwriting_them(self):
        self.shards.mkdir()
        for contents in ("not JSON", "null", "{}", "[]"):
            with self.subTest(contents=contents):
                self.fingerprint.write_text(contents)
                with self.assertRaises(RuntimeError):
                    embed_cards.check_checkpoint_dataset(self.cards)
                self.assertEqual(self.fingerprint.read_text(), contents)

    def test_main_stops_before_model_loading_when_the_dataset_changes(self):
        embed_cards.check_checkpoint_dataset(self.cards)
        args = argparse.Namespace(limit=None, batch_size=16, download_workers=4)

        with patch.object(embed_cards, "parse_args", return_value=args), patch.object(
            embed_cards, "load_cards", return_value=list(reversed(self.cards))
        ), patch.object(embed_cards, "load_model") as load_model, patch.object(
            embed_cards, "embed_range"
        ) as embed_range, patch(
            "builtins.print"
        ):
            with self.assertRaisesRegex(RuntimeError, "dataset or model differs"):
                embed_cards.main()

        load_model.assert_not_called()
        embed_range.assert_not_called()

    def test_empty_input_stops_without_creating_a_fingerprint(self):
        args = argparse.Namespace(limit=None, batch_size=16, download_workers=4)

        with patch.object(embed_cards, "parse_args", return_value=args), patch.object(
            embed_cards, "load_cards", return_value=[]
        ), patch.object(embed_cards, "load_model") as load_model, patch(
            "builtins.print"
        ):
            with self.assertRaisesRegex(RuntimeError, "No cards found"):
                embed_cards.main()

        load_model.assert_not_called()
        self.assertFalse(self.fingerprint.exists())


class ModelRevisionTests(unittest.TestCase):
    def test_loads_model_and_processor_from_the_same_pinned_revision(self):
        with patch.object(
            common.AutoProcessor, "from_pretrained"
        ) as processor, patch.object(common.AutoModel, "from_pretrained") as model:
            common.load_model()

        for loader in (processor, model):
            loader.assert_called_once_with(
                common.MODEL_NAME, revision=common.MODEL_REVISION
            )


if __name__ == "__main__":
    unittest.main()
