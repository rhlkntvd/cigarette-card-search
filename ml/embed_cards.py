"""Embed card images with SigLIP2.

Run from the repository root:
    python -m ml.embed_cards
"""

import argparse
import json
import re
import threading
from concurrent.futures import (
    ThreadPoolExecutor,
    as_completed,
)
from pathlib import Path
from time import perf_counter

import torch

from ml.common import (
    create_http_session,
    embed_images,
    fetch_image,
    get_device,
    load_model,
)

ROOT = Path(__file__).resolve().parents[1]

CARDS_PATH = ROOT / "data" / "processed" / "cards.jsonl"

OUTPUT_DIR = ROOT / "data" / "embeddings"

SHARD_DIR = OUTPUT_DIR / "shards"

EMBEDDINGS_PATH = OUTPUT_DIR / "image_embeddings.pt"

METADATA_PATH = OUTPUT_DIR / "cards.jsonl"

FAILURES_PATH = OUTPUT_DIR / "failures.jsonl"


CHECKPOINT_SIZE = 256
DEFAULT_BATCH_SIZE = 16
DEFAULT_DOWNLOAD_WORKERS = 4

SHARD_PATTERN = re.compile(r"^shard-(\d+)-(\d+)\.pt$")

THREAD_LOCAL = threading.local()


def parse_args():
    parser = argparse.ArgumentParser(
        description=("Generate SigLIP2 embeddings " "for cigarette card images")
    )

    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help=("Only process the first N cards. " "Useful for testing."),
    )

    parser.add_argument(
        "--batch-size",
        type=int,
        default=DEFAULT_BATCH_SIZE,
        help=("Number of images passed through " "SigLIP2 at once."),
    )

    parser.add_argument(
        "--download-workers",
        type=int,
        default=DEFAULT_DOWNLOAD_WORKERS,
        help=("Number of concurrent workers used " "to download IIIF images."),
    )

    return parser.parse_args()


def load_cards(
    path: Path,
    limit: int | None,
) -> list[dict]:
    cards = []

    with path.open(
        "r",
        encoding="utf-8",
    ) as file:
        for line in file:
            line = line.strip()

            if not line:
                continue

            cards.append(json.loads(line))

            if limit is not None and len(cards) >= limit:
                break

    return cards


def get_shard_paths(
    start: int,
    end: int,
) -> tuple[Path, Path, Path]:
    stem = f"shard-{start:06d}-{end:06d}"

    return (
        SHARD_DIR / f"{stem}.pt",
        SHARD_DIR / f"{stem}.jsonl",
        SHARD_DIR / f"{stem}.failures.jsonl",
    )


def get_resume_index() -> int:
    if not SHARD_DIR.exists():
        return 0

    shards = []

    for path in SHARD_DIR.glob(
        "shard-*.pt",
    ):
        match = SHARD_PATTERN.match(
            path.name,
        )

        if match is None:
            continue

        start = int(match.group(1))
        end = int(match.group(2))

        _, metadata_path, _ = get_shard_paths(
            start,
            end,
        )

        if metadata_path.exists():
            shards.append((start, end))

    shards.sort()

    expected_start = 0

    for start, end in shards:
        if start != expected_start:
            break

        expected_start = end + 1

    return expected_start


def write_jsonl(
    path: Path,
    rows: list[dict],
):
    temporary = path.with_suffix(path.suffix + ".tmp")

    with temporary.open(
        "w",
        encoding="utf-8",
    ) as file:
        for row in rows:
            file.write(json.dumps(row) + "\n")

    temporary.replace(path)


def save_shard(
    start: int,
    end: int,
    embeddings: list[torch.Tensor],
    cards: list[dict],
    failures: list[dict],
):
    if not embeddings:
        raise RuntimeError(
            "Checkpoint produced no embeddings. "
            "Stopping so this range can be retried."
        )

    embedding_matrix = torch.stack(
        embeddings,
    )

    if len(embedding_matrix) != len(cards):
        raise RuntimeError("Embedding and metadata counts differ")

    (
        embedding_path,
        metadata_path,
        failure_path,
    ) = get_shard_paths(
        start,
        end,
    )

    temporary_embedding_path = embedding_path.with_suffix(".pt.tmp")

    torch.save(
        embedding_matrix,
        temporary_embedding_path,
    )

    temporary_embedding_path.replace(
        embedding_path,
    )

    write_jsonl(
        metadata_path,
        cards,
    )

    write_jsonl(
        failure_path,
        failures,
    )


def get_thread_session():
    session = getattr(
        THREAD_LOCAL,
        "session",
        None,
    )

    if session is None:
        session = create_http_session()
        THREAD_LOCAL.session = session

    return session


def fetch_card_image(
    index: int,
    card: dict,
):
    session = get_thread_session()

    image = fetch_image(
        card["frontImageId"],
        session=session,
    )

    return index, card, image


def fetch_batch_images(
    batch_cards: list[dict],
    batch_start: int,
    download_workers: int,
):
    successes = []
    failures = []

    max_workers = min(
        download_workers,
        len(batch_cards),
    )

    with ThreadPoolExecutor(
        max_workers=max_workers,
    ) as executor:
        future_to_item = {
            executor.submit(
                fetch_card_image,
                index,
                card,
            ): (index, card)
            for index, card in enumerate(
                batch_cards,
                start=batch_start,
            )
        }

        for future in as_completed(future_to_item):
            index, card = future_to_item[future]

            try:
                result = future.result()
                successes.append(result)

            except Exception as error:
                failures.append(
                    {
                        "index": index,
                        "dplaId": card["dplaId"],
                        "title": card["title"],
                        "error": str(error),
                    }
                )

    successes.sort(key=lambda item: item[0])

    images = []
    valid_cards = []

    for index, card, image in successes:
        images.append(image)
        valid_cards.append((index, card))

    return images, valid_cards, failures


def embed_range(
    cards: list[dict],
    start: int,
    end: int,
    batch_size: int,
    download_workers: int,
    processor,
    model,
):
    embeddings = []
    embedded_cards = []
    failures = []

    total_download_seconds = 0.0
    total_inference_seconds = 0.0

    for batch_start in range(
        start,
        end + 1,
        batch_size,
    ):
        batch_end = min(
            batch_start + batch_size,
            end + 1,
        )

        batch_cards = cards[batch_start:batch_end]

        download_started = perf_counter()

        (
            images,
            valid_cards,
            batch_failures,
        ) = fetch_batch_images(
            batch_cards,
            batch_start,
            download_workers,
        )

        download_seconds = perf_counter() - download_started

        total_download_seconds += download_seconds

        failures.extend(batch_failures)

        inference_seconds = 0.0

        if images:
            inference_started = perf_counter()

            try:
                batch_embeddings = embed_images(
                    images,
                    processor,
                    model,
                )

                for (
                    embedding,
                    (_, card),
                ) in zip(
                    batch_embeddings,
                    valid_cards,
                ):
                    embeddings.append(
                        embedding,
                    )

                    embedded_cards.append(
                        card,
                    )

            except Exception as error:
                print("Batch inference failed; " "retrying images individually.")

                for (
                    image,
                    (index, card),
                ) in zip(
                    images,
                    valid_cards,
                ):
                    try:
                        embedding = embed_images(
                            [image],
                            processor,
                            model,
                        )[0]

                        embeddings.append(
                            embedding,
                        )

                        embedded_cards.append(
                            card,
                        )

                    except Exception as item_error:
                        failures.append(
                            {
                                "index": index,
                                "dplaId": card["dplaId"],
                                "title": card["title"],
                                "error": (f"{error}; " f"{item_error}"),
                            }
                        )

            finally:
                inference_seconds = perf_counter() - inference_started

                total_inference_seconds += inference_seconds

                for image in images:
                    image.close()

        print(
            f"Processed {batch_end} "
            f"of {len(cards)} cards "
            f"| download: "
            f"{download_seconds:.2f}s "
            f"| inference: "
            f"{inference_seconds:.2f}s"
        )

    return (
        embeddings,
        embedded_cards,
        failures,
        total_download_seconds,
        total_inference_seconds,
    )


def get_completed_shards():
    shards = []

    if not SHARD_DIR.exists():
        return shards

    for path in SHARD_DIR.glob(
        "shard-*.pt",
    ):
        match = SHARD_PATTERN.match(
            path.name,
        )

        if match is None:
            continue

        start = int(match.group(1))
        end = int(match.group(2))

        (
            _,
            metadata_path,
            failure_path,
        ) = get_shard_paths(
            start,
            end,
        )

        if metadata_path.exists():
            shards.append(
                (
                    start,
                    end,
                    path,
                    metadata_path,
                    failure_path,
                )
            )

    shards.sort(
        key=lambda shard: shard[0],
    )

    return shards


def finalize_outputs():
    shards = get_completed_shards()

    if not shards:
        raise RuntimeError("No embedding shards found")

    matrices = []

    OUTPUT_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    metadata_temp = METADATA_PATH.with_suffix(".jsonl.tmp")

    failures_temp = FAILURES_PATH.with_suffix(".jsonl.tmp")

    with (
        metadata_temp.open(
            "w",
            encoding="utf-8",
        ) as metadata_file,
        failures_temp.open(
            "w",
            encoding="utf-8",
        ) as failure_file,
    ):
        for (
            _,
            _,
            embedding_path,
            metadata_path,
            failure_path,
        ) in shards:
            matrix = torch.load(
                embedding_path,
                map_location="cpu",
                weights_only=True,
            )

            matrices.append(
                matrix,
            )

            metadata_file.write(
                metadata_path.read_text(
                    encoding="utf-8",
                )
            )

            if failure_path.exists():
                failure_file.write(
                    failure_path.read_text(
                        encoding="utf-8",
                    )
                )

    embedding_matrix = torch.cat(
        matrices,
        dim=0,
    )

    embeddings_temp = EMBEDDINGS_PATH.with_suffix(".pt.tmp")

    torch.save(
        embedding_matrix,
        embeddings_temp,
    )

    embeddings_temp.replace(
        EMBEDDINGS_PATH,
    )

    metadata_temp.replace(
        METADATA_PATH,
    )

    failures_temp.replace(
        FAILURES_PATH,
    )

    return embedding_matrix


def main():
    args = parse_args()

    if args.limit is not None and args.limit < 1:
        raise ValueError("limit must be at least 1")

    if args.batch_size < 1:
        raise ValueError("batch size must be at least 1")

    if args.download_workers < 1:
        raise ValueError("download workers must be at least 1")

    cards = load_cards(
        CARDS_PATH,
        args.limit,
    )

    print(f"Loaded {len(cards)} cards")

    SHARD_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    resume_index = get_resume_index()

    if resume_index > len(cards):
        raise RuntimeError(
            "Existing checkpoints were created " "from a larger/different dataset."
        )

    print(f"Resuming at card {resume_index}")

    device = get_device()

    print(f"Using device: {device}")

    print("Loading SigLIP2...")

    processor, model = load_model(
        device=device,
    )

    start = resume_index

    while start < len(cards):
        end = min(
            start + CHECKPOINT_SIZE - 1,
            len(cards) - 1,
        )

        print()
        print(f"Embedding cards " f"{start}–{end}")

        (
            embeddings,
            embedded_cards,
            failures,
            download_seconds,
            inference_seconds,
        ) = embed_range(
            cards,
            start,
            end,
            args.batch_size,
            args.download_workers,
            processor,
            model,
        )

        save_shard(
            start,
            end,
            embeddings,
            embedded_cards,
            failures,
        )

        print(
            f"Saved checkpoint "
            f"{start}–{end}: "
            f"{len(embedded_cards)} succeeded, "
            f"{len(failures)} failed"
        )

        print(
            f"Checkpoint timing: "
            f"download "
            f"{download_seconds:.2f}s, "
            f"inference "
            f"{inference_seconds:.2f}s"
        )

        start = end + 1

    embedding_matrix = finalize_outputs()

    print()
    print("Embedding complete")
    print("------------------")
    print("Embedding matrix shape: " f"{embedding_matrix.shape}")
    print(f"Metadata: {METADATA_PATH}")
    print(f"Failures: {FAILURES_PATH}")


if __name__ == "__main__":
    main()
