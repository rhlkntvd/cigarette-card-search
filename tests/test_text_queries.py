import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import torch
from fastapi import HTTPException
from starlette.requests import Request
from transformers.tokenization_utils_base import BatchEncoding

from ml import embedding_service
from ml.common import TEXT_MAX_TOKENS, TextTooLongError, embed_texts


class TextEmbeddingTests(unittest.TestCase):
    def test_normalizes_each_text_independently_without_reordering_rows(self):
        processor = Mock(
            return_value=BatchEncoding(
                {"input_ids": [[1] * TEXT_MAX_TOKENS, [2] * TEXT_MAX_TOKENS]}
            )
        )
        model = Mock()
        model.parameters.return_value = iter([torch.zeros(1)])
        features = torch.zeros(2, 768)
        features[0, :2] = torch.tensor([3.0, 4.0])
        features[1, 1] = 12.0
        model.get_text_features.return_value = features

        embeddings = embed_texts(["butterfly", "sailing ship"], processor, model)

        expected = torch.zeros(2, 768)
        expected[0, :2] = torch.tensor([0.6, 0.8])
        expected[1, 1] = 1.0
        self.assertTrue(torch.allclose(embeddings, expected))

    def test_accepts_the_token_boundary_and_returns_normalized_embeddings(self):
        processor = Mock(
            return_value=BatchEncoding({"input_ids": [[1] * TEXT_MAX_TOKENS]})
        )
        model = Mock()
        model.parameters.return_value = iter([torch.zeros(1)])
        model.get_text_features.return_value = torch.ones(1, 768)

        embeddings = embed_texts(["butterfly"], processor, model)

        self.assertEqual(embeddings.shape, (1, 768))
        self.assertTrue(torch.allclose(embeddings.norm(dim=1), torch.ones(1)))
        self.assertEqual(
            model.get_text_features.call_args.kwargs["input_ids"].shape,
            (1, TEXT_MAX_TOKENS),
        )
        self.assertFalse(processor.call_args.kwargs["truncation"])

    def test_rejects_long_and_mixed_batches_before_inference(self):
        for texts, lengths in [
            (["long"], [TEXT_MAX_TOKENS + 1]),
            (["short", "long"], [TEXT_MAX_TOKENS, TEXT_MAX_TOKENS + 1]),
        ]:
            with self.subTest(lengths=lengths):
                processor = Mock(
                    return_value=BatchEncoding(
                        {
                            "input_ids": [[1] * length for length in lengths],
                        }
                    )
                )
                model = Mock()

                with self.assertRaises(TextTooLongError):
                    embed_texts(texts, processor, model)

                model.get_text_features.assert_not_called()
                model.parameters.assert_not_called()


class EmbeddingEndpointTests(unittest.TestCase):
    def setUp(self):
        app = SimpleNamespace(state=SimpleNamespace(processor=Mock(), model=Mock()))
        self.request = Request({"type": "http", "app": app})

    def test_rejects_empty_and_whitespace_requests_before_inference(self):
        with patch.object(embedding_service, "embed_texts") as embed:
            for text in ("", " \t\n "):
                with self.subTest(text=text):
                    with self.assertRaises(HTTPException) as caught:
                        embedding_service.embed(
                            embedding_service.EmbedRequest(text=text), self.request
                        )
                    self.assertEqual(caught.exception.status_code, 400)
                    self.assertEqual(caught.exception.detail, "Text must not be empty.")

        embed.assert_not_called()

    def test_rejects_large_requests_before_tokenization(self):
        with patch.object(embedding_service, "embed_texts") as embed:
            with self.assertRaises(HTTPException) as caught:
                embedding_service.embed(
                    embedding_service.EmbedRequest(
                        text="a" * (embedding_service.MAX_TEXT_LENGTH + 1)
                    ),
                    self.request,
                )

        embed.assert_not_called()
        self.assertEqual(caught.exception.status_code, 400)
        self.assertEqual(caught.exception.detail["code"], "text_too_long")

    def test_maps_only_token_limit_errors_to_http_400(self):
        for error in [TextTooLongError("too long"), ValueError("inference failed")]:
            with self.subTest(error_type=type(error)):
                with patch.object(embedding_service, "embed_texts", side_effect=error):
                    expected = (
                        HTTPException
                        if isinstance(error, TextTooLongError)
                        else ValueError
                    )
                    with self.assertRaises(expected) as caught:
                        embedding_service.embed(
                            embedding_service.EmbedRequest(text="butterfly"),
                            self.request,
                        )
                if isinstance(caught.exception, HTTPException):
                    self.assertEqual(caught.exception.status_code, 400)
                    self.assertEqual(caught.exception.detail["code"], "text_too_long")

    def test_preserves_trimming_and_successful_response(self):
        with patch.object(
            embedding_service, "embed_texts", return_value=torch.ones(1, 768)
        ) as embed:
            response = embedding_service.embed(
                embedding_service.EmbedRequest(text="  a blue butterfly  "),
                self.request,
            )

        self.assertEqual(embed.call_args.args[0], ["a blue butterfly"])
        self.assertEqual(response.dimensions, 768)
        self.assertEqual(len(response.embedding), 768)


if __name__ == "__main__":
    unittest.main()
