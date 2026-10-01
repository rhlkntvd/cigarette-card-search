import json
from pathlib import Path

import torch

from common import (
    embed_image,
    fetch_image,
    load_model,
)

ROOT = Path(__file__).resolve().parents[1]

CARDS_PATH = ROOT / "data" / "processed" / "cards.jsonl"

OUTPUT_DIR = ROOT / "data" / "embeddings"

EMBEDDINGS_PATH = OUTPUT_DIR / "image_embeddings.pt"

METADATA_PATH = OUTPUT_DIR / "cards.jsonl"


def load_cards(path: Path) -> list[dict]:
    cards = []

    with path.open("r", encoding="utf-8") as file:
        for line in file:
            line = line.strip()

            if not line:
                continue

            cards.append(json.loads(line))

    return cards


def main():
    cards = load_cards(CARDS_PATH)

    print(f"Loaded {len(cards)} cards")

    processor, model = load_model()

    embeddings = []
    embedded_cards = []

    for index, card in enumerate(cards, start=1):
        title = card["title"]
        image_id = card["frontImageId"]

        print(f"[{index}/{len(cards)}] " f"Embedding {title}")

        try:
            image = fetch_image(image_id)

            embedding = embed_image(
                image,
                processor,
                model,
            )

            embeddings.append(embedding.squeeze(0).cpu())

            embedded_cards.append(card)

        except Exception as error:
            print(f"failed to embed {title}: {error}")

    if not embeddings:
        raise RuntimeError("no image embeddings were generated")

    embedding_matrix = torch.stack(embeddings)

    OUTPUT_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    torch.save(
        embedding_matrix,
        EMBEDDINGS_PATH,
    )

    with METADATA_PATH.open(
        "w",
        encoding="utf-8",
    ) as file:
        for card in embedded_cards:
            file.write(json.dumps(card) + "\n")

    print()
    print(f"Saved {len(embedded_cards)} embeddings")

    print(f"embedding matrix shape: " f"{embedding_matrix.shape}")


if __name__ == "__main__":
    main()
