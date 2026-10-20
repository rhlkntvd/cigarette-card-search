"""Import card metadata and embeddings into an empty PostgreSQL cards table.

Run from the repository root:
    python -m ml.import_pgvector
"""

import json
import os
from pathlib import Path
from typing import Any

import psycopg
import torch
from dotenv import load_dotenv
from pgvector import Vector
from pgvector.psycopg import register_vector

ROOT = Path(__file__).resolve().parents[1]

EMBEDDINGS_PATH = ROOT / "data" / "embeddings" / "image_embeddings.pt"

METADATA_PATH = ROOT / "data" / "embeddings" / "cards.jsonl"

EXPECTED_DIMENSIONS = 768
BATCH_SIZE = 500


INSERT_SQL = """
INSERT INTO cards (
    dpla_id,
    nypl_uuid,
    title,
    front_image_id,
    back_image_id,
    source_url,
    rights,
    display_eligible,
    embedding
)
VALUES (
    %s,
    %s,
    %s,
    %s,
    %s,
    %s,
    %s,
    %s,
    %s
)
"""


def get_database_url() -> str:
    database_url = os.environ.get(
        "DATABASE_URL",
    )

    if not database_url:
        raise RuntimeError("DATABASE_URL is not set")

    return database_url


def load_cards() -> list[dict[str, Any]]:
    cards: list[dict[str, Any]] = []

    with METADATA_PATH.open(
        "r",
        encoding="utf-8",
    ) as file:
        for line_number, line in enumerate(
            file,
            start=1,
        ):
            if not line.strip():
                continue

            try:
                card = json.loads(line)
            except json.JSONDecodeError as error:
                raise RuntimeError(
                    "Invalid JSON in " f"{METADATA_PATH} " f"at line {line_number}"
                ) from error

            if not isinstance(card, dict):
                raise RuntimeError(
                    "Expected JSON object in "
                    f"{METADATA_PATH} "
                    f"at line {line_number}"
                )

            cards.append(card)

    return cards


def load_embeddings() -> torch.Tensor:
    embeddings = torch.load(
        EMBEDDINGS_PATH,
        map_location="cpu",
    )

    if not isinstance(
        embeddings,
        torch.Tensor,
    ):
        raise RuntimeError("Embedding file did not contain " "a PyTorch tensor")

    if embeddings.ndim != 2:
        raise RuntimeError(
            "Expected a 2D embedding tensor, " f"got shape {tuple(embeddings.shape)}"
        )

    if embeddings.shape[1] != EXPECTED_DIMENSIONS:
        raise RuntimeError(
            "Expected "
            f"{EXPECTED_DIMENSIONS} dimensions, "
            f"got {embeddings.shape[1]}"
        )

    if not torch.isfinite(
        embeddings,
    ).all():
        raise RuntimeError("Embedding tensor contains " "NaN or infinite values")

    return embeddings.float()


def validate_alignment(
    cards: list[dict[str, Any]],
    embeddings: torch.Tensor,
) -> None:
    card_count = len(cards)
    embedding_count = embeddings.shape[0]

    if card_count != embedding_count:
        raise RuntimeError(
            "Metadata and embeddings are "
            "not aligned: "
            f"{card_count} cards vs "
            f"{embedding_count} embeddings"
        )


def count_display_eligible(
    cards: list[dict[str, Any]],
) -> int:
    return sum(card.get("displayEligible") is True for card in cards)


def make_row(
    card: dict[str, Any],
    embedding: torch.Tensor,
) -> tuple[Any, ...]:
    required_fields = [
        "dplaId",
        "nyplUuid",
        "title",
        "frontImageId",
        "sourceUrl",
        "displayEligible",
    ]

    for field in required_fields:
        if field not in card:
            raise RuntimeError(f"Card is missing required " f"field: {field}")

    return (
        card["dplaId"],
        card["nyplUuid"],
        card["title"],
        card["frontImageId"],
        card.get("backImageId"),
        card["sourceUrl"],
        card.get("rights"),
        card["displayEligible"],
        Vector(
            embedding.tolist(),
        ),
    )


def main() -> None:
    load_dotenv(ROOT / ".env", override=False)
    database_url = get_database_url()

    print("Loading embedding metadata...")
    cards = load_cards()

    print("Loading image embeddings...")
    embeddings = load_embeddings()

    validate_alignment(
        cards,
        embeddings,
    )

    display_eligible_count = count_display_eligible(cards)

    print()
    print("Import preflight")
    print("----------------------")
    print(f"Cards: {len(cards)}")
    print("Embedding matrix shape: " f"{tuple(embeddings.shape)}")
    print("Display eligible: " f"{display_eligible_count}")

    print()
    print("Connecting to PostgreSQL...")

    with psycopg.connect(
        database_url,
    ) as connection:
        register_vector(connection)

        existing_count = connection.execute("SELECT COUNT(*) FROM cards").fetchone()

        if existing_count is None:
            raise RuntimeError("Could not read cards table")

        if existing_count[0] != 0:
            raise RuntimeError("cards table is not empty: " f"{existing_count[0]} rows")

        print("Importing cards...")

        for start in range(
            0,
            len(cards),
            BATCH_SIZE,
        ):
            end = min(
                start + BATCH_SIZE,
                len(cards),
            )

            rows = [
                make_row(
                    cards[index],
                    embeddings[index],
                )
                for index in range(
                    start,
                    end,
                )
            ]

            with connection.cursor() as cursor:
                cursor.executemany(
                    INSERT_SQL,
                    rows,
                )

            print(f"Imported {end} " f"of {len(cards)} cards")

        result = connection.execute("""
            SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (
                    WHERE embedding IS NULL
                ) AS missing_embeddings,
                COUNT(*) FILTER (
                    WHERE display_eligible
                ) AS display_eligible
            FROM cards
            """).fetchone()

        if result is None:
            raise RuntimeError("Could not verify import")

        (
            database_count,
            missing_embeddings,
            database_display_eligible,
        ) = result

        if database_count != len(cards):
            raise RuntimeError(
                "Database row count does not "
                "match imported metadata: "
                f"{database_count} vs "
                f"{len(cards)}"
            )

        if missing_embeddings != 0:
            raise RuntimeError("Database contains rows " "without embeddings")

        if database_display_eligible != display_eligible_count:
            raise RuntimeError("Display-eligible count changed " "during import")

    print()
    print("Import complete")
    print("----------------------")
    print(f"Database rows: {database_count}")
    print(f"Missing embeddings: " f"{missing_embeddings}")
    print("Display eligible: " f"{database_display_eligible}")


if __name__ == "__main__":
    main()
