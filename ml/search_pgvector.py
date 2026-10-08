import argparse
import os
from time import perf_counter
from typing import Any

import psycopg
from pgvector import Vector
from pgvector.psycopg import register_vector

from common import (
    embed_texts,
    get_device,
    get_iiif_url,
    load_model,
)

DEFAULT_LIMIT = 5


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=("Search cigarette cards using " "SigLIP2 and pgvector.")
    )

    parser.add_argument(
        "--limit",
        type=int,
        default=DEFAULT_LIMIT,
        help="Number of results to return.",
    )

    parser.add_argument(
        "--public-only",
        action="store_true",
        help=("Search only cards eligible " "for public display."),
    )

    return parser.parse_args()


def get_database_url() -> str:
    database_url = os.environ.get(
        "DATABASE_URL",
    )

    if not database_url:
        raise RuntimeError("DATABASE_URL is not set")

    return database_url


def search_cards(
    connection: psycopg.Connection[Any],
    query_embedding: Vector,
    limit: int,
    public_only: bool,
) -> list[tuple[Any, ...]]:
    where_clause = ""

    if public_only:
        where_clause = "WHERE cards.display_eligible = TRUE"

    sql = f"""
    WITH query AS (
        SELECT %s::vector AS embedding
    )
    SELECT
        cards.dpla_id,
        cards.title,
        cards.front_image_id,
        cards.source_url,
        cards.rights,
        cards.display_eligible,
        1 - (
            cards.embedding
            <=> query.embedding
        ) AS similarity
    FROM cards
    CROSS JOIN query
    {where_clause}
    ORDER BY
        cards.embedding
        <=> query.embedding
    LIMIT %s
    """

    result = connection.execute(
        sql,
        (
            query_embedding,
            limit,
        ),
    )

    return result.fetchall()


def main() -> None:
    args = parse_args()

    if args.limit < 1:
        raise RuntimeError("--limit must be at least 1")

    database_url = get_database_url()

    device = get_device()

    print(f"Using device: {device}")

    print("Loading SigLIP2...")

    processor, model = load_model(
        device,
    )

    with psycopg.connect(
        database_url,
    ) as connection:
        register_vector(connection)

        counts = connection.execute("""
            SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (
                    WHERE display_eligible
                ) AS display_eligible
            FROM cards
            """).fetchone()

        if counts is None:
            raise RuntimeError("Could not read cards table")

        total_count = counts[0]
        display_eligible_count = counts[1]

        print()
        print("Database")
        print("----------------------")
        print(f"Cards: {total_count}")
        print("Display eligible: " f"{display_eligible_count}")
        print("Search scope: " + ("public only" if args.public_only else "full corpus"))

        print()
        print("Enter a search query.")
        print("Type 'quit' or 'exit' to stop.")

        while True:
            print()

            try:
                query = input("Search: ").strip()
            except (
                EOFError,
                KeyboardInterrupt,
            ):
                print()
                break

            if query.lower() in {
                "quit",
                "exit",
            }:
                break

            if not query:
                continue

            embedding_start = perf_counter()

            query_tensor = embed_texts(
                [query],
                processor,
                model,
            )[0]

            embedding_seconds = perf_counter() - embedding_start

            query_vector = Vector(
                query_tensor.tolist(),
            )

            database_start = perf_counter()

            rows = search_cards(
                connection,
                query_vector,
                args.limit,
                args.public_only,
            )

            database_seconds = perf_counter() - database_start

            print()

            for rank, row in enumerate(
                rows,
                start=1,
            ):
                (
                    dpla_id,
                    title,
                    front_image_id,
                    source_url,
                    rights,
                    display_eligible,
                    similarity,
                ) = row

                print(f"{rank}. {title}")

                print("   Similarity: " f"{float(similarity):.4f}")

                print(
                    "   Image: "
                    + get_iiif_url(
                        str(front_image_id),
                    )
                )

                print(f"   Source: {source_url}")

                print(f"   DPLA ID: {dpla_id}")

                print("   Display eligible: " f"{display_eligible}")

                print(f"   Rights: {rights}")

            print()
            print("Timing")
            print("----------------------")

            print("Text embedding: " f"{embedding_seconds * 1000:.1f} ms")

            print("Database search: " f"{database_seconds * 1000:.1f} ms")


if __name__ == "__main__":
    main()
