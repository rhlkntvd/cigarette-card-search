import json
from pathlib import Path

import torch

from common import (
    embed_texts,
    get_iiif_url,
    load_model,
)

ROOT = Path(__file__).resolve().parents[1]

EMBEDDING_DIR = ROOT / "data" / "embeddings"

EMBEDDINGS_PATH = EMBEDDING_DIR / "image_embeddings.pt"

METADATA_PATH = EMBEDDING_DIR / "cards.jsonl"


def main():
    print("Loading image embeddings...")

    image_embeddings = torch.load(
        EMBEDDINGS_PATH,
        map_location="cpu",
        weights_only=True,
    )

    cards = []

    with METADATA_PATH.open(
        "r",
        encoding="utf-8",
    ) as file:
        for line in file:
            line = line.strip()

            if not line:
                continue

            cards.append(json.loads(line))

    if len(cards) != len(image_embeddings):
        raise RuntimeError("card metadata and embedding count differ")

    print("Loading SigLIP2 model...")

    processor, model = load_model()

    print()
    print(f"Loaded {len(cards)} cards.")
    print("Type a search query, or 'quit' to exit.")

    while True:
        query = input("\nSearch: ").strip()

        if query.lower() in {"quit", "exit"}:
            print("Exiting.")
            break

        if not query:
            continue

        query_embedding = embed_texts(
            [query],
            processor,
            model,
        ).squeeze(0)

        scores = image_embeddings @ query_embedding

        top_k = min(5, len(cards))

        top_scores, top_indices = torch.topk(
            scores,
            k=top_k,
        )

        print()

        for rank, (score, index) in enumerate(
            zip(top_scores, top_indices),
            start=1,
        ):
            card = cards[index.item()]

            print(f"{rank}. {card['title']} " f"({score.item():.4f})")

            print(
                "   "
                + get_iiif_url(
                    card["frontImageId"],
                    size=512,
                )
            )


if __name__ == "__main__":
    main()
